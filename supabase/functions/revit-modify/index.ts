import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface Transform {
  dbId: number;
  elementName: string;
  originalPosition: { x: number; y: number; z: number };
  newPosition: { x: number; y: number; z: number };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { token, projectId, itemId, transforms } = await req.json();
    
    console.log('Starting Design Automation workflow:', {
      projectId,
      itemId,
      transformCount: transforms.length
    });

    if (!token || !projectId || !itemId || !transforms) {
      return new Response(
        JSON.stringify({ error: 'Missing required parameters' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Step 1: Get item details and download URL
    console.log('Step 1: Fetching item details...');
    const itemResponse = await fetch(
      `https://developer.api.autodesk.com/data/v1/projects/b.${projectId}/items/${itemId}`,
      { headers: { 'Authorization': `Bearer ${token}` } }
    );

    if (!itemResponse.ok) {
      throw new Error(`Failed to fetch item: ${itemResponse.status}`);
    }

    const itemData = await itemResponse.json();
    const tipVersionId = itemData.data.relationships.tip.data.id;
    
    console.log('Tip version ID:', tipVersionId);

    // Step 2: Get version details for storage location
    const versionResponse = await fetch(
      `https://developer.api.autodesk.com/data/v1/projects/b.${projectId}/versions/${encodeURIComponent(tipVersionId)}`,
      { headers: { 'Authorization': `Bearer ${token}` } }
    );

    if (!versionResponse.ok) {
      throw new Error(`Failed to fetch version: ${versionResponse.status}`);
    }

    const versionData = await versionResponse.json();
    const storageId = versionData.data.relationships.storage.data.id;
    
    console.log('Storage ID:', storageId);

    // Step 3: Parse storage ID and get signed download URL
    // Storage ID format: urn:adsk.objects:os.object:BUCKET_KEY/OBJECT_KEY
    const storageIdParts = storageId.split(':');
    const bucketAndObject = storageIdParts[storageIdParts.length - 1]; // Get last part after last colon
    const [bucketKey, ...objectKeyParts] = bucketAndObject.split('/');
    const objectKey = objectKeyParts.join('/'); // Rejoin in case object has slashes
    
    console.log('Parsed storage - Bucket:', bucketKey, 'Object:', objectKey);
    
    const storageResponse = await fetch(
      `https://developer.api.autodesk.com/oss/v2/buckets/${bucketKey}/objects/${objectKey}/signeds3download`,
      { headers: { 'Authorization': `Bearer ${token}` } }
    );

    if (!storageResponse.ok) {
      const errorText = await storageResponse.text();
      console.error('Storage download error:', storageResponse.status, errorText);
      throw new Error(`Failed to get download URL: ${storageResponse.status} - ${errorText}`);
    }

    const downloadData = await storageResponse.json();
    const downloadUrl = downloadData.url;
    
    console.log('Got download URL');

    // Step 4: Download the Revit file
    console.log('Step 2: Downloading Revit file...');
    const fileResponse = await fetch(downloadUrl);
    if (!fileResponse.ok) {
      throw new Error(`Failed to download file: ${fileResponse.status}`);
    }
    
    const fileBlob = await fileResponse.blob();
    console.log('File downloaded, size:', fileBlob.size);

    // Step 5: Prepare Design Automation WorkItem
    console.log('Step 3: Creating Design Automation WorkItem...');
    
    // For now, we'll simulate the Design Automation workflow
    // In production, you would:
    // 1. Upload file to DA workspace
    // 2. Create WorkItem with transformation parameters
    // 3. Poll for completion
    // 4. Download modified file
    // 5. Upload back to ACC
    
    // TODO: Implement actual Design Automation calls
    // This requires the AppBundle and Activity to be configured first
    
    console.log('Design Automation integration pending - AppBundle setup required');
    console.log('Transforms to apply:', JSON.stringify(transforms, null, 2));

    // Step 6: Return success (for now, simulated)
    return new Response(
      JSON.stringify({
        success: true,
        message: 'Design Automation workflow initiated',
        transformsApplied: transforms.length,
        note: 'Full DA integration requires AppBundle setup - see docs/RevitPlugin.cs'
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );

  } catch (error) {
    console.error('Design Automation error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    
    return new Response(
      JSON.stringify({ 
        error: message,
        details: 'Design Automation API integration incomplete - requires AppBundle setup'
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});
