import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const REGULAR_CLIENT_ID = "UonGGAilCryEuzl6kCD2owAcIiFZXobglVyZamHkTktJg2AY";
const SSA_CLIENT_ID = "DfARgfaBERc4spAWY2UOoKBKLH475EKX372DBiy0r9tYTKeL";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Helper function to get regular app token (has bucket:create permissions)
async function getRegularAppToken(clientSecret: string): Promise<string> {
  const tokenResponse = await fetch('https://developer.api.autodesk.com/authentication/v2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: REGULAR_CLIENT_ID,
      client_secret: clientSecret,
      scope: 'bucket:create bucket:read data:read data:write',
    }),
  });
  
  if (!tokenResponse.ok) {
    const error = await tokenResponse.text();
    throw new Error(`Failed to get regular app token: ${error}`);
  }
  
  const data = await tokenResponse.json();
  return data.access_token;
}

// DISTINCTIVE STARTUP LOG TO CONFIRM NEW CODE IS RUNNING
console.log('🚀 NEW REUPLOAD-FILE-SSA FUNCTION VERSION LOADED - TIMESTAMP:', new Date().toISOString());

serve(async (req) => {
  console.log('🔥 NEW VERSION HANDLING REQUEST');
  
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { userToken, projectId, folderUrn, itemUrn, fileName } = await req.json();

    console.log('Re-uploading file to OSS:', { projectId, folderUrn, fileName });

    // Step 1: Get regular app token (will be used for bucket creation and file upload)
    const regularClientSecret = Deno.env.get('AUTODESK_CLIENT_SECRET');
    if (!regularClientSecret) {
      throw new Error('AUTODESK_CLIENT_SECRET not configured');
    }
    
    console.log('[REUPLOAD] Step 1: Getting regular app token...');
    const regularToken = await getRegularAppToken(regularClientSecret);
    console.log('[REUPLOAD] ✅ Got regular app token:', regularToken.substring(0, 20) + '...');

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
    console.log('[REUPLOAD] Step 3: Downloading from ACC...');
    console.log('[REUPLOAD] ✅ Downloaded file:', fileBuffer.byteLength, 'bytes');

    // Step 5: Upload to permanent OSS bucket
    // Use permanent bucket name
    const ossBucketKey = 'revit-transform-temp';
    const ossObjectKey = `${crypto.randomUUID()}.rvt`;
    
    console.log('[REUPLOAD] Step 4: Uploading to OSS bucket...');
    console.log('[REUPLOAD]   - Bucket:', ossBucketKey);
    console.log('[REUPLOAD]   - Object:', ossObjectKey);
    console.log('[REUPLOAD]   - Size:', fileBuffer.byteLength, 'bytes');
    
    // Step 5.1: Ensure OSS bucket exists using regular app token
    console.log('[REUPLOAD] Step 2: Ensuring bucket exists...');
    
    const createBucketResponse = await fetch(
      'https://developer.api.autodesk.com/oss/v2/buckets',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${regularToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          bucketKey: ossBucketKey,
          policyKey: 'persistent', // Permanent bucket
        }),
      }
    );

    // 409 conflict means bucket already exists - that's fine!
    if (!createBucketResponse.ok && createBucketResponse.status !== 409) {
      const error = await createBucketResponse.text();
      console.error('[REUPLOAD] ❌ Failed to create bucket:', error);
      throw new Error(`Failed to create bucket: ${error}`);
    }

    if (createBucketResponse.status === 409) {
      console.log('[REUPLOAD] ✅ Bucket already exists, using existing:', ossBucketKey);
    } else {
      console.log('[REUPLOAD] ✅ Created new persistent OSS bucket:', ossBucketKey);
    }
    console.log('[REUPLOAD] ✅ Bucket ready');
    
    // Step 6: Upload file using modern 3-step signed S3 upload
    console.log('[REUPLOAD] Getting signed S3 upload URL...');
    
    const signedUploadRequest = await fetch(
      `https://developer.api.autodesk.com/oss/v2/buckets/${ossBucketKey}/objects/${ossObjectKey}/signeds3upload?firstPart=1&parts=1`,
      {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${regularToken}`,
        },
      }
    );
    
    console.log('[REUPLOAD] Signed URL response status:', signedUploadRequest.status);
    
    if (!signedUploadRequest.ok) {
      const error = await signedUploadRequest.text();
      console.error('[REUPLOAD] ❌ Failed to get signed URL:', error);
      throw new Error(`Failed to get signed upload URL: ${error}`);
    }
    
    const signedUploadData = await signedUploadRequest.json();
    const uploadKey = signedUploadData.uploadKey;
    const uploadUrl = signedUploadData.urls?.[0];
    
    if (!uploadKey || !uploadUrl) {
      throw new Error('Invalid signeds3upload response: missing uploadKey or urls[0]');
    }
    
    console.log('[REUPLOAD] ✅ Got signed URL');
    
    // Step 6b: Upload file to S3
    console.log('[REUPLOAD] Uploading to S3...');
    const s3UploadResponse = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/octet-stream',
      },
      body: fileBuffer,
    });
    
    console.log('[REUPLOAD] S3 upload response status:', s3UploadResponse.status);
    
    if (!s3UploadResponse.ok) {
      const s3Error = await s3UploadResponse.text();
      console.error('[REUPLOAD] ❌ S3 upload failed:', s3Error);
      throw new Error(`S3 upload failed: ${s3UploadResponse.status} - ${s3Error}`);
    }
    
    console.log('[REUPLOAD] ✅ S3 upload complete');
    
    // Step 6c: Finalize upload
    console.log('[REUPLOAD] Finalizing upload...');
    const finalizeResponse = await fetch(
      `https://developer.api.autodesk.com/oss/v2/buckets/${ossBucketKey}/objects/${ossObjectKey}/signeds3upload`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${regularToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ uploadKey }),
      }
    );
    
    console.log('[REUPLOAD] Finalize response status:', finalizeResponse.status);
    
    if (!finalizeResponse.ok) {
      const error = await finalizeResponse.text();
      console.error('[REUPLOAD] ❌ Finalize failed:', error);
      throw new Error(`Failed to finalize upload: ${error}`);
    }
    
    console.log('[REUPLOAD] ✅ Upload finalized successfully');
    
    // CRITICAL: Verify object exists immediately
    console.log('[REUPLOAD] VERIFICATION: Checking if object exists...');
    const verifyResponse = await fetch(
      `https://developer.api.autodesk.com/oss/v2/buckets/${ossBucketKey}/objects/${encodeURIComponent(ossObjectKey)}/details`,
      {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${regularToken}` }
      }
    );

    console.log('[REUPLOAD] Verification response status:', verifyResponse.status);

    if (verifyResponse.ok) {
      const objectDetails = await verifyResponse.json();
      console.log('[REUPLOAD] ✅ Object verified in bucket!');
      console.log('[REUPLOAD]   - Object ID:', objectDetails.objectId);
      console.log('[REUPLOAD]   - Size:', objectDetails.size, 'bytes');
    } else {
      const verifyError = await verifyResponse.text();
      console.error('[REUPLOAD] ⚠️ Object not immediately visible:', verifyError);
      console.error('[REUPLOAD]    This suggests eventual consistency delay or upload failure');
    }
    
    console.log('[REUPLOAD] ✅ File uploaded to regular OSS bucket');
    console.log('[REUPLOAD] OSS Bucket:', ossBucketKey);
    console.log('[REUPLOAD] OSS Object:', ossObjectKey);

    return new Response(JSON.stringify({
      success: true,
      ossBucket: ossBucketKey,
      ossObject: ossObjectKey,
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
