import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import JSZip from "https://esm.sh/jszip@3.10.1";

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
    const { workItemId, cachedToken } = await req.json();

    if (!workItemId) {
      return new Response(
        JSON.stringify({ error: 'Missing workItemId parameter' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('[REVIT-STATUS] Checking status for WorkItem:', workItemId);
    console.log('[REVIT-STATUS] Using cached token:', !!cachedToken);

    // Use cached token if provided, otherwise fetch a new one
    let token = cachedToken;
    
    if (!token) {
      console.log('[REVIT-STATUS] No cached token, fetching new token...');
      
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
      token = tokenData.access_token;
    }

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

      // Download and extract debug ZIP using JSZip
      try {
        console.log('[REVIT-STATUS] Downloading debug ZIP...');
        const debugResponse = await fetch(statusData.debugInfoUrl);
        
        if (debugResponse.ok) {
          const debugArrayBuffer = await debugResponse.arrayBuffer();
          console.log('[REVIT-STATUS] Debug ZIP downloaded, size:', debugArrayBuffer.byteLength);
          
          // Use JSZip to extract in memory (pure JS, no Deno.run needed)
          const zip = await JSZip.loadAsync(debugArrayBuffer);
          
          const debugContent: any = {
            allFiles: [],        // List of ALL files in ZIP
            textFiles: [],       // Files with readable content
            journalFiles: [],    // Keep journals separate for backwards compatibility
            skippedFiles: []     // Large/binary files we skipped
          };
          
          // Define which extensions to read content from
          const textExtensions = ['.jrn', '.log', '.txt', '.json', '.xml', '.addin', '.cfg', '.ini', '.err'];
          const maxFileSize = 500000; // 500KB max per file
          
          // Iterate through all files in the ZIP
          for (const [filePath, zipEntry] of Object.entries(zip.files)) {
            if ((zipEntry as any).dir) continue; // Skip directories
            
            debugContent.allFiles.push(filePath);
            
            const ext = filePath.toLowerCase().substring(filePath.lastIndexOf('.'));
            const isTextFile = textExtensions.some(e => filePath.toLowerCase().endsWith(e));
            
            if (isTextFile) {
              try {
                const content = await (zipEntry as any).async('string');
                
                // Skip if file is too large (likely misidentified binary)
                if (content.length > maxFileSize) {
                  debugContent.skippedFiles.push({
                    name: filePath,
                    reason: `Too large (${content.length} bytes)`
                  });
                  continue;
                }
                
                // Truncate large files
                const truncatedContent = content.length > 100000 
                  ? '...[truncated]...\n' + content.slice(-100000)
                  : content;
                
                // Store in appropriate array
                if (filePath.endsWith('.jrn')) {
                  debugContent.journalFiles.push({
                    name: filePath,
                    size: content.length,
                    content: truncatedContent
                  });
                  console.log('[REVIT-STATUS] Found journal:', filePath, `(${content.length} bytes)`);
                } else {
                  debugContent.textFiles.push({
                    name: filePath,
                    size: content.length,
                    content: truncatedContent
                  });
                  console.log('[REVIT-STATUS] Read text file:', filePath, `(${content.length} bytes)`);
                }
              } catch (e) {
                debugContent.skippedFiles.push({
                  name: filePath,
                  reason: `Error reading: ${e}`
                });
              }
            } else if (!filePath.endsWith('.rvt')) {
              // For non-text, non-RVT files, note their existence
              debugContent.skippedFiles.push({
                name: filePath,
                reason: 'Binary or non-text file'
              });
            }
          }
          
          response.debugContent = debugContent;
      console.log('[REVIT-STATUS] Debug content extracted:', 
        `${debugContent.journalFiles.length} journals, ${debugContent.textFiles.length} text files, ${debugContent.allFiles.length} total files`);
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
