import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  console.log('[REVIT-COMPLETE] Request received at', new Date().toISOString());

  try {
    const { token, projectId, itemId, folderUrn, bucketKeyTemp, outputObjectKey } = await req.json();

    // Validate required fields
    if (!token || !projectId || !itemId || !bucketKeyTemp || !outputObjectKey) {
      return new Response(
        JSON.stringify({ 
          error: 'Missing required parameters',
          required: ['token', 'projectId', 'itemId', 'bucketKeyTemp', 'outputObjectKey']
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('[REVIT-COMPLETE] Processing completion for:', { projectId, itemId, bucketKeyTemp, outputObjectKey });

    // Get 2-legged token for OSS operations
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
        scope: 'bucket:read data:read data:write',
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
    const twoLeggedToken = tokenData.access_token;

    // ========== STEP 8: DOWNLOAD MODIFIED FILE ==========
    console.log('[REVIT-COMPLETE] Downloading modified file from temp bucket...');
    
    const modifiedFileResponse = await fetch(
      `https://developer.api.autodesk.com/oss/v2/buckets/${bucketKeyTemp}/objects/${outputObjectKey}`,
      { headers: { 'Authorization': `Bearer ${twoLeggedToken}` } }
    );

    if (!modifiedFileResponse.ok) {
      const errorText = await modifiedFileResponse.text();
      return new Response(
        JSON.stringify({ 
          error: 'Failed to download modified file from temp bucket',
          details: errorText 
        }),
        { status: modifiedFileResponse.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const modifiedFile = await modifiedFileResponse.blob();
    console.log('[REVIT-COMPLETE] Modified file downloaded, size:', modifiedFile.size, 'bytes');

    // ========== STEP 9: GET ITEM DETAILS ==========
    console.log('[REVIT-COMPLETE] Fetching item details...');
    
    const itemResponse = await fetch(
      `https://developer.api.autodesk.com/data/v1/projects/b.${projectId}/items/${itemId}`,
      { headers: { 'Authorization': `Bearer ${token}` } }
    );

    if (!itemResponse.ok) {
      const errorText = await itemResponse.text();
      return new Response(
        JSON.stringify({ 
          error: 'Failed to fetch item details',
          details: errorText 
        }),
        { status: itemResponse.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const itemData = await itemResponse.json();

    // ========== STEP 10: UPLOAD TO ACC STORAGE ==========
    console.log('[REVIT-COMPLETE] Uploading modified file back to ACC storage...');
    
    const storagePayload = {
      jsonapi: { version: '1.0' },
      data: {
        type: 'objects',
        attributes: {
          name: itemData.data.attributes.displayName
        },
        relationships: {
          target: {
            data: {
              type: 'folders',
              id: itemData.data.relationships.parent.data.id
            }
          }
        }
      }
    };

    const createStorageResponse = await fetch(
      `https://developer.api.autodesk.com/data/v1/projects/b.${projectId}/storage`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/vnd.api+json'
        },
        body: JSON.stringify(storagePayload)
      }
    );

    if (!createStorageResponse.ok) {
      const errorText = await createStorageResponse.text();
      return new Response(
        JSON.stringify({ 
          error: 'Failed to create ACC storage',
          details: errorText 
        }),
        { status: createStorageResponse.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const newStorageData = await createStorageResponse.json();
    const newStorageId = newStorageData.data.id;
    console.log('[REVIT-COMPLETE] New ACC storage created:', newStorageId);

    // Parse new storage ID and upload modified file
    const newStorageParts = newStorageId.split(':');
    const newBucketAndObject = newStorageParts[newStorageParts.length - 1];
    const [newBucketKey, ...newObjectKeyParts] = newBucketAndObject.split('/');
    const newObjectKey = newObjectKeyParts.join('/');

    const uploadModifiedResponse = await fetch(
      `https://developer.api.autodesk.com/oss/v2/buckets/${newBucketKey}/objects/${newObjectKey}`,
      {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/octet-stream'
        },
        body: modifiedFile
      }
    );

    if (!uploadModifiedResponse.ok) {
      const errorText = await uploadModifiedResponse.text();
      return new Response(
        JSON.stringify({ 
          error: 'Failed to upload modified file to ACC',
          details: errorText 
        }),
        { status: uploadModifiedResponse.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('[REVIT-COMPLETE] Modified file uploaded to ACC storage');

    // ========== STEP 11: CREATE NEW VERSION ==========
    console.log('[REVIT-COMPLETE] Creating new version in ACC...');
    
    const versionPayload = {
      jsonapi: { version: '1.0' },
      data: {
        type: 'versions',
        attributes: {
          name: itemData.data.attributes.displayName,
          extension: {
            type: 'versions:autodesk.bim360:C4RModel',
            version: '1.0'
          }
        },
        relationships: {
          item: {
            data: {
              type: 'items',
              id: itemId
            }
          },
          storage: {
            data: {
              type: 'objects',
              id: newStorageId
            }
          }
        }
      }
    };

    const newVersionResponse = await fetch(
      `https://developer.api.autodesk.com/data/v1/projects/b.${projectId}/versions`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/vnd.api+json'
        },
        body: JSON.stringify(versionPayload)
      }
    );

    if (!newVersionResponse.ok) {
      const errorText = await newVersionResponse.text();
      return new Response(
        JSON.stringify({ 
          error: 'Failed to create new version in ACC',
          details: errorText 
        }),
        { status: newVersionResponse.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const newVersion = await newVersionResponse.json();
    const versionId = newVersion.data.id;

    console.log('[REVIT-COMPLETE] New version created:', versionId);

    return new Response(
      JSON.stringify({
        success: true,
        versionId,
        uploadedSize: modifiedFile.size,
        message: 'File processing completed successfully'
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[REVIT-COMPLETE] Error:', error);
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
