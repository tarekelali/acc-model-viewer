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
    
    // Extract C4R extension data from original version (needed for creating new version)
    const originalExtension = versionData.data.attributes?.extension;
    const extensionData = originalExtension?.data || {};
    console.log('Original extension data:', JSON.stringify(extensionData, null, 2));

    // Check file size - edge functions have ~500MB memory limit
    const fileSize = versionData.data.attributes?.storageSize;
    if (fileSize && fileSize > 100 * 1024 * 1024) { // 100MB limit
      throw new Error(`File too large (${Math.round(fileSize / 1024 / 1024)}MB). Edge functions cannot handle files over 100MB. Please use smaller files or a different upload method.`);
    }

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

    // Step 5: Create/ensure regular OSS bucket exists (not ACC managed)
    console.log('Step 5: Ensuring regular OSS bucket exists...');
    const ossBucketKey = 'revit-transform-input';
    const ossObjectKey = `${crypto.randomUUID()}.rvt`;
    
    console.log('Target OSS Bucket:', ossBucketKey);
    console.log('Target OSS Object:', ossObjectKey);
    
    // Try to create bucket (will fail if exists, which is fine)
    const createBucketResponse = await fetch(
      'https://developer.api.autodesk.com/oss/v2/buckets',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${ssaToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          bucketKey: ossBucketKey,
          policyKey: 'persistent', // Keep files for 30 days
        }),
      }
    );
    
    if (createBucketResponse.ok) {
      console.log('✅ Created new OSS bucket:', ossBucketKey);
    } else {
      const error = await createBucketResponse.text();
      // 409 Conflict means bucket already exists, which is fine
      if (createBucketResponse.status === 409) {
        console.log('✅ OSS bucket already exists:', ossBucketKey);
      } else {
        console.warn('Warning creating bucket (continuing anyway):', error);
      }
    }
    
    // Step 6: Upload file to regular OSS bucket using resumable upload
    console.log('Step 6: Uploading file to regular OSS bucket...');
    
    // Calculate file size in bytes
    const fileSizeBytes = fileBuffer.byteLength;
    console.log('File size:', fileSizeBytes, 'bytes');
    
    // Use OSS resumable upload for reliability
    const uploadResponse = await fetch(
      `https://developer.api.autodesk.com/oss/v2/buckets/${ossBucketKey}/objects/${ossObjectKey}/resumable`,
      {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${ssaToken}`,
          'Content-Type': 'application/octet-stream',
          'Content-Length': fileSizeBytes.toString(),
        },
        body: fileBuffer,
      }
    );
    
    if (!uploadResponse.ok) {
      const error = await uploadResponse.text();
      console.error('Failed to upload to OSS bucket:', error);
      throw new Error(`Failed to upload to OSS bucket: ${error}`);
    }
    
    const uploadData = await uploadResponse.json();
    console.log('✅ File uploaded to regular OSS bucket');
    console.log('Upload response:', JSON.stringify(uploadData, null, 2));
    console.log('OSS Bucket:', ossBucketKey);
    console.log('OSS Object:', ossObjectKey);

    return new Response(JSON.stringify({
      success: true,
      ossBucket: ossBucketKey,
      ossObject: ossObjectKey,
      uploadDetails: uploadData,
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
