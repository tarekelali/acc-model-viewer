import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SSA_CLIENT_ID = "DfARgfaBERc4spAWY2UOoKBKLH475EKX372DBiy0r9tYTKeL";

serve(async (req) => {
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
    const versionsUrl = `https://developer.api.autodesk.com/data/v1/projects/${formattedProjectId}/items/${encodeURIComponent(itemUrn)}/versions`;
    const versionsResponse = await fetch(versionsUrl, {
      headers: {
        'Authorization': `Bearer ${userToken}`,
      },
    });

    if (!versionsResponse.ok) {
      const error = await versionsResponse.text();
      throw new Error(`Failed to get versions: ${error}`);
    }

    const versionsData = await versionsResponse.json();
    const latestVersion = versionsData.data[0];
    console.log('Latest version:', latestVersion.id);

    // Get storage location
    const storageUrl = `https://developer.api.autodesk.com/data/v1/projects/${formattedProjectId}/versions/${encodeURIComponent(latestVersion.id)}/relationships/storage`;
    const storageResponse = await fetch(storageUrl, {
      headers: {
        'Authorization': `Bearer ${userToken}`,
      },
    });

    if (!storageResponse.ok) {
      const error = await storageResponse.text();
      throw new Error(`Failed to get storage: ${error}`);
    }

    const storageData = await storageResponse.json();
    const storageUrn = storageData.data.id;
    console.log('Storage URN:', storageUrn);

    // Parse OSS bucket and object from storage URN
    const urnParts = storageUrn.split('/');
    const bucketKey = urnParts[urnParts.length - 2];
    const objectKey = urnParts[urnParts.length - 1];

    // Step 3: Generate signed download URL (using user token)
    console.log('Generating signed download URL...');
    const downloadUrlResponse = await fetch(
      `https://developer.api.autodesk.com/oss/v2/buckets/${bucketKey}/objects/${objectKey}/signeds3download`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${userToken}`,
        },
      }
    );

    if (!downloadUrlResponse.ok) {
      const error = await downloadUrlResponse.text();
      throw new Error(`Failed to generate download URL: ${error}`);
    }

    const downloadUrlData = await downloadUrlResponse.json();
    const downloadUrl = downloadUrlData.url || downloadUrlData.signedUrl;
    console.log('Download URL obtained');

    // Step 4: Download the file content
    console.log('Downloading file content...');
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
      throw new Error(`Failed to create storage: ${error}`);
    }

    const newStorageData = await newStorageResponse.json();
    const newStorageUrn = newStorageData.data.id;
    console.log('New storage created:', newStorageUrn);

    // Parse new OSS location
    const newUrnParts = newStorageUrn.split('/');
    const newBucketKey = newUrnParts[newUrnParts.length - 2];
    const newObjectKey = newUrnParts[newUrnParts.length - 1];

    // Step 6: Upload file to new OSS location using SSA token
    console.log('Uploading file to new storage...');
    const uploadResponse = await fetch(
      `https://developer.api.autodesk.com/oss/v2/buckets/${newBucketKey}/objects/${newObjectKey}`,
      {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${ssaToken}`,
          'Content-Type': 'application/octet-stream',
        },
        body: fileBuffer,
      }
    );

    if (!uploadResponse.ok) {
      const error = await uploadResponse.text();
      throw new Error(`Failed to upload file: ${error}`);
    }

    console.log('File uploaded successfully');

    // Step 7: Create new version in ACC
    console.log('Creating new version in ACC...');
    const versionResponse = await fetch(
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

    if (!versionResponse.ok) {
      const error = await versionResponse.text();
      throw new Error(`Failed to create version: ${error}`);
    }

    const versionData = await versionResponse.json();
    console.log('New version created:', versionData.data.id);

    return new Response(JSON.stringify({
      success: true,
      message: 'File re-uploaded successfully with SSA credentials',
      newVersionUrn: versionData.data.id,
      newStorageUrn,
      fileSize: fileBuffer.byteLength,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Re-upload error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
