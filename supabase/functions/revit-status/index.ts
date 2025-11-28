import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { decompress } from "https://deno.land/x/zip@v1.2.5/mod.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  console.log('[REVIT-STATUS] Request received at', new Date().toISOString());

  try {
    const { workItemId } = await req.json();

    if (!workItemId) {
      return new Response(
        JSON.stringify({ error: 'Missing workItemId parameter' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('[REVIT-STATUS] Checking status for WorkItem:', workItemId);

    // Get 2-legged token for Design Automation API
    const clientId = 'UonGGAilCryEuzl6kCD2owAcIiFZXobglVyZamHkTktJg2AY';
    const clientSecret = Deno.env.get('AUTODESK_CLIENT_SECRET');

    if (!clientSecret) {
      return new Response(
        JSON.stringify({ error: 'AUTODESK_CLIENT_SECRET not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const tokenResponse = await fetch('https://developer.api.autodesk.com/authentication/v2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
        scope: 'code:all',
      }),
    });

    if (!tokenResponse.ok) {
      const error = await tokenResponse.text();
      return new Response(
        JSON.stringify({ error: 'Failed to get token', details: error }),
        { status: tokenResponse.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const tokenData = await tokenResponse.json();
    const token = tokenData.access_token;

    // Query WorkItem status
    const statusResponse = await fetch(
      `https://developer.api.autodesk.com/da/us-east/v3/workitems/${workItemId}`,
      { headers: { 'Authorization': `Bearer ${token}` } }
    );

    if (!statusResponse.ok) {
      const errorText = await statusResponse.text();
      return new Response(
        JSON.stringify({ 
          error: 'Failed to query WorkItem status',
          details: errorText,
          workItemId 
        }),
        { status: statusResponse.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const statusData = await statusResponse.json();
    const status = statusData.status;

    console.log('[REVIT-STATUS] WorkItem status:', status);

    // Prepare response
    const response: any = {
      workItemId,
      status,
      stats: statusData.stats
    };

    // If failed, fetch the detailed report
    if (status === 'failedInstructions' || status === 'failedUpload' || status === 'failedDownload') {
      response.reportUrl = statusData.reportUrl;
      
      if (statusData.reportUrl) {
        try {
          console.log('[REVIT-STATUS] Fetching failure report...');
          const reportResponse = await fetch(statusData.reportUrl);
          if (reportResponse.ok) {
            response.reportContent = await reportResponse.text();
            console.log('[REVIT-STATUS] Report fetched successfully');
          }
        } catch (e) {
          console.error('[REVIT-STATUS] Error fetching report:', e);
        }
      }
    }

    // Include debug info URL if available
    if (statusData.debugInfoUrl) {
      response.debugInfoUrl = statusData.debugInfoUrl;
      console.log('[REVIT-STATUS] Debug info URL available:', statusData.debugInfoUrl);

      // Download and extract debug ZIP
      try {
        console.log('[REVIT-STATUS] Downloading debug ZIP...');
        const debugResponse = await fetch(statusData.debugInfoUrl);
        
        if (debugResponse.ok) {
          const debugArrayBuffer = await debugResponse.arrayBuffer();
          const debugUint8Array = new Uint8Array(debugArrayBuffer);
          
          console.log('[REVIT-STATUS] Debug ZIP downloaded, size:', debugUint8Array.length);
          
          // Create a temporary file to unzip
          const tempZipPath = await Deno.makeTempFile({ suffix: '.zip' });
          await Deno.writeFile(tempZipPath, debugUint8Array);
          
          const tempDir = await Deno.makeTempDir();
          await decompress(tempZipPath, tempDir);
          
          console.log('[REVIT-STATUS] Debug ZIP extracted to:', tempDir);
          
          // Read all files in the extracted directory
          const debugContent: any = {
            journalFiles: [],
            otherFiles: []
          };
          
          async function readDirectory(dir: string, relativePath = '') {
            for await (const entry of Deno.readDir(dir)) {
              const fullPath = `${dir}/${entry.name}`;
              const relPath = relativePath ? `${relativePath}/${entry.name}` : entry.name;
              
              if (entry.isDirectory) {
                await readDirectory(fullPath, relPath);
              } else if (entry.isFile) {
                if (entry.name.endsWith('.jrn')) {
                  // Read journal file content
                  const content = await Deno.readTextFile(fullPath);
                  // Keep last 100KB of journal (most relevant)
                  const truncatedContent = content.length > 100000 
                    ? '...[truncated]...\n' + content.slice(-100000)
                    : content;
                  
                  debugContent.journalFiles.push({
                    name: relPath,
                    size: content.length,
                    content: truncatedContent
                  });
                  console.log('[REVIT-STATUS] Found journal:', relPath, `(${content.length} bytes)`);
                } else {
                  debugContent.otherFiles.push(relPath);
                }
              }
            }
          }
          
          await readDirectory(tempDir);
          
          // Cleanup temp files
          await Deno.remove(tempZipPath);
          await Deno.remove(tempDir, { recursive: true });
          
          response.debugContent = debugContent;
          console.log('[REVIT-STATUS] Debug content extracted:', 
            `${debugContent.journalFiles.length} journals, ${debugContent.otherFiles.length} other files`);
        }
      } catch (e) {
        console.error('[REVIT-STATUS] Error processing debug ZIP:', e);
        response.debugError = e instanceof Error ? e.message : 'Unknown error processing debug info';
      }
    }

    return new Response(
      JSON.stringify(response),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[REVIT-STATUS] Error:', error);
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
