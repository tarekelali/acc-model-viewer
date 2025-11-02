import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SSA_CLIENT_ID = "DfARgfaBERc4spAWY2UOoKBKLH475EKX372DBiy0r9tYTKeL";

// DISTINCTIVE STARTUP LOG TO CONFIRM NEW CODE IS RUNNING
console.log('🚀 NEW REUPLOAD-FILE-SSA FUNCTION VERSION LOADED - TIMESTAMP:', new Date().toISOString());

serve(async (req) => {
  console.log('🔥 NEW VERSION HANDLING REQUEST');
  
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { userToken, projectId, folderUrn, itemUrn, fileName } = await req.json();

    console.log('Re-uploading file with SSA credentials:', { projectId, folderUrn, fileName });

    const ssaClientSecret = Deno.env.get('AUTODESK_SSA_CLIENT_SECRET');
    if (!ssaClientSecret) {
      throw new Error('AUTODESK_SSA_CLIENT_SECRET not configured - please add the m&cp-configurator app client secret');
    }

    // Step 1: Get SSA 2-legged token with data:write and data:create scopes
    console.log('Getting SSA token...');
    const tokenResponse = await fetch('https://developer.api.autodesk.com/authentication/v2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: SSA_CLIENT_ID,
        client_secret: ssaClientSecret,
        scope: 'data:read data:write data:create code:all',
      }),
    });

    if (!tokenResponse.ok) {
      const error = await tokenResponse.text();
      throw new Error(`Failed to get SSA token: ${error}`);
    }

    const tokenData = await tokenResponse.json();
    const ssaToken = tokenData.access_token;
    console.log('SSA token obtained successfully');

    // Step 2: Download the existing file using user's token
    console.log('Getting storage location for existing file...');
    const formattedProjectId = projectId.startsWith('b.') ? projectId : `b.${projectId}`;
    
    // Get the latest version of the item
    const itemUrl = `https://developer.api.autodesk.com/data/v1/projects/${formattedProjectId}/items/${encodeURIComponent(itemUrn)}`;
    const itemResponse = await fetch(itemUrl, {
      headers: {
        'Authorization': `Bearer ${userToken}`,
      },
    });

    if (!itemResponse.ok) {
      const error = await itemResponse.text();
      throw new Error(`Failed to get item: ${error}`);
    }

    const itemData = await itemResponse.json();
    const tipVersionId = itemData.data.relationships.tip.data.id;
    console.log('Latest version:', tipVersionId);

    // Get version details (includes storage)
    const versionUrl = `https://developer.api.autodesk.com/data/v1/projects/${formattedProjectId}/versions/${encodeURIComponent(tipVersionId)}`;
    const versionResponse = await fetch(versionUrl, {
      headers: {
        'Authorization': `Bearer ${userToken}`,
      },
    });

    if (!versionResponse.ok) {
      const error = await versionResponse.text();
      throw new Error(`Failed to get version: ${error}`);
    }

    const versionData = await versionResponse.json();
    const storageUrn = versionData.data.relationships.storage.data.id;
    console.log('Storage URN:', storageUrn);

    // Parse OSS bucket and object from storage URN
    // URN format: urn:adsk.objects:os.object:BUCKET_KEY/OBJECT_KEY
    const lastSlashIndex = storageUrn.lastIndexOf('/');
    const objectKey = storageUrn.substring(lastSlashIndex + 1);
    const bucketPart = storageUrn.substring(0, lastSlashIndex);
    const bucketKey = bucketPart.substring(bucketPart.lastIndexOf(':') + 1);
    console.log('Parsed OSS location - Bucket:', bucketKey, 'Object:', objectKey);

    // Step 3: Get signed download URL using GET (not POST!) for ACC files
    console.log('Step 3: Getting signed download URL for ACC file with USER token...');
    console.log('Bucket:', bucketKey, 'Object:', objectKey);
    
    const downloadUrlResponse = await fetch(
      `https://developer.api.autodesk.com/oss/v2/buckets/${bucketKey}/objects/${encodeURIComponent(objectKey)}/signeds3download`,
      {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${userToken}`,
        },
      }
    );

    if (!downloadUrlResponse.ok) {
      const error = await downloadUrlResponse.text();
      console.error('Failed to get signed download URL. Bucket:', bucketKey, 'Object:', objectKey, 'Error:', error);
      throw new Error(`Failed to get signed download URL: ${error}`);
    }

    const downloadUrlData = await downloadUrlResponse.json();
    const downloadUrl = downloadUrlData.url;
    console.log('✅ Step 3: Signed download URL obtained');

    // Step 4: Download the file content
    console.log('Step 4: Downloading file content from signed URL...');
    const fileResponse = await fetch(downloadUrl);
    if (!fileResponse.ok) {
      throw new Error(`Failed to download file: ${fileResponse.statusText}`);
    }

    const fileBuffer = await fileResponse.arrayBuffer();
    console.log('File downloaded, size:', fileBuffer.byteLength, 'bytes');

    // Step 5: Create new OSS storage location using SSA token
    console.log('Creating new storage location with SSA token...');
    const newStorageResponse = await fetch(
      `https://developer.api.autodesk.com/data/v1/projects/${formattedProjectId}/storage`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${ssaToken}`,
          'Content-Type': 'application/vnd.api+json',
        },
        body: JSON.stringify({
          jsonapi: { version: '1.0' },
          data: {
            type: 'objects',
            attributes: {
              name: fileName,
            },
            relationships: {
              target: {
                data: {
                  type: 'folders',
                  id: folderUrn,
                },
              },
            },
          },
        }),
      }
    );

    if (!newStorageResponse.ok) {
      const error = await newStorageResponse.text();
      console.error('Failed to create storage:', error);
      throw new Error(`Failed to create storage: ${error}`);
    }

    const newStorageData = await newStorageResponse.json();
    console.log('📦 FULL STORAGE RESPONSE:', JSON.stringify(newStorageData, null, 2));
    const newStorageUrn = newStorageData.data.id;
    const objectId = newStorageData.data?.relationships?.storage?.data?.id || newStorageUrn;
    console.log('New storage created:', newStorageUrn);
    console.log('Object ID:', objectId);

    // Parse new OSS location
    // URN format: urn:adsk.objects:os.object:BUCKET_KEY/OBJECT_KEY
    const newLastSlashIndex = newStorageUrn.lastIndexOf('/');
    const newObjectKey = newStorageUrn.substring(newLastSlashIndex + 1);
    const newBucketPart = newStorageUrn.substring(0, newLastSlashIndex);
    const newBucketKey = newBucketPart.substring(newBucketPart.lastIndexOf(':') + 1);
    console.log('New OSS location - Bucket:', newBucketKey, 'Object:', newObjectKey);

    // Step 6: Upload file directly to ACC managed bucket (wip.dm.prod)
    // ACC buckets support direct PUT with Bearer token - no signeds3upload needed
    console.log('Step 6: Uploading file directly to ACC managed bucket...');
    const uploadUrl = `https://developer.api.autodesk.com/oss/v2/buckets/${newBucketKey}/objects/${newObjectKey}`;
    console.log('Upload URL:', uploadUrl);
    
    const uploadResponse = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${ssaToken}`,
        'Content-Type': 'application/octet-stream',
      },
      body: fileBuffer,
    });

    if (!uploadResponse.ok) {
      const error = await uploadResponse.text();
      console.error('Failed to upload file:', error);
      throw new Error(`Failed to upload file: ${error}`);
    }

    console.log('✅ Step 6: File uploaded successfully to ACC managed bucket');
    console.log('✅ SSA app now owns the file');

    // Step 7: Create new version in ACC
    console.log('Creating new version in ACC with SSA token...');
    const newVersionResponse = await fetch(
      `https://developer.api.autodesk.com/data/v1/projects/${formattedProjectId}/versions`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${ssaToken}`,
          'Content-Type': 'application/vnd.api+json',
        },
        body: JSON.stringify({
          jsonapi: { version: '1.0' },
          data: {
            type: 'versions',
            attributes: {
              name: fileName,
              extension: {
                type: 'versions:autodesk.bim360:C4RModelVersion',
                version: '1.0',
              },
            },
            relationships: {
              item: {
                data: {
                  type: 'items',
                  id: itemUrn,
                },
              },
              storage: {
                data: {
                  type: 'objects',
                  id: newStorageUrn,
                },
              },
            },
          },
        }),
      }
    );

    if (!newVersionResponse.ok) {
      const error = await newVersionResponse.text();
      console.error('Failed to create version:', error);
      throw new Error(`Failed to create version: ${error}`);
    }

    const newVersionData = await newVersionResponse.json();
    const newVersionUrn = newVersionData.data.id;
    console.log('✅ New version created successfully:', newVersionUrn);
    console.log('✅ SSA app now owns this version');
    console.log('Storage details - Bucket:', newBucketKey, 'Object:', newObjectKey);

    return new Response(JSON.stringify({
      success: true,
      message: 'File re-uploaded successfully with SSA credentials',
      newVersionUrn,
      newStorageUrn,
      objectId,
      newBucketKey,
      newObjectKey,
      fileSize: fileBuffer.byteLength,
      fullStorageResponse: newStorageData,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('❌ NEW CODE - Re-upload error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
