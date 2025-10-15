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

    // Get 2-legged token for Design Automation API
    const clientId = 'UonGGAilCryEuzl6kCD2owAcIiFZXobglVyZamHkTktJg2AY';
    const clientSecret = Deno.env.get('AUTODESK_CLIENT_SECRET');
    
    console.log('Getting 2-legged token for Design Automation...');
    const tokenResponse = await fetch('https://developer.api.autodesk.com/authentication/v2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret!,
        scope: 'code:all bucket:create bucket:read data:read data:write',
      }),
    });

    if (!tokenResponse.ok) {
      const error = await tokenResponse.text();
      throw new Error(`Failed to get 2-legged token: ${error}`);
    }

    const tokenData = await tokenResponse.json();
    const twoLeggedToken = tokenData.access_token;
    console.log('Got 2-legged token for Design Automation');

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
    const storageIdParts = storageId.split(':');
    const bucketAndObject = storageIdParts[storageIdParts.length - 1];
    const [bucketKey, ...objectKeyParts] = bucketAndObject.split('/');
    const objectKey = objectKeyParts.join('/');
    
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
    
    console.log('Got signed download URL for input file');

    // Step 4: Get aliases for Design Automation
    const appBundleAlias = Deno.env.get('DA_APPBUNDLE_ALIAS') || `${clientId}.RevitTransformPlugin+1`;
    const activityAlias = Deno.env.get('DA_ACTIVITY_ALIAS') || `${clientId}.TransformActivityFinal2+1`;
    
    console.log('Using AppBundle:', appBundleAlias);
    console.log('Using Activity:', activityAlias);

    // Step 5: Create temporary bucket for output file only
    console.log('Step 5: Creating temporary bucket for output...');
    
    const bucketKeyTemp = `revit_temp_${Date.now()}`;
    
    const createBucketResponse = await fetch(
      'https://developer.api.autodesk.com/oss/v2/buckets',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${twoLeggedToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          bucketKey: bucketKeyTemp,
          policyKey: 'transient' // Auto-delete after 24 hours
        })
      }
    );

    if (!createBucketResponse.ok && createBucketResponse.status !== 409) {
      const errorText = await createBucketResponse.text();
      console.warn('Bucket creation warning:', errorText);
    }

    // Get signed URL for output file
    const outputObjectKey = 'output.rvt';
    const minutesExpiration = 30;
    const outputSignedResponse = await fetch(
      `https://developer.api.autodesk.com/oss/v2/buckets/${bucketKeyTemp}/objects/${outputObjectKey}/signed?access=readwrite`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${twoLeggedToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          minutesExpiration: minutesExpiration
        })
      }
    );
    
    const outputSignedData = await outputSignedResponse.json();
    const outputSignedUrl = outputSignedData.signedUrl;
    
    console.log('Output bucket and signed URL ready');

    // Step 6: Create WorkItem
    console.log('Step 6: Creating Design Automation WorkItem...');
    
    const transformsJson = JSON.stringify({ transforms });
    const transformsDataUrl = `data:application/json,${encodeURIComponent(transformsJson)}`;

    const workItemPayload = {
      activityId: activityAlias,
      arguments: {
        inputFile: {
          url: downloadUrl, // Use original signed download URL directly
          verb: 'get'
        },
        transforms: {
          url: transformsDataUrl,
          verb: 'get'
        },
        outputFile: {
          url: outputSignedUrl,
          verb: 'put',
          headers: {
            'Content-Type': 'application/octet-stream'
          }
        }
      }
    };

    console.log('Creating WorkItem with activity:', activityAlias);

    const workItemResponse = await fetch(
      'https://developer.api.autodesk.com/da/us-east/v3/workitems',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${twoLeggedToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(workItemPayload)
      }
    );

    if (!workItemResponse.ok) {
      const errorData = await workItemResponse.json();
      console.error('WorkItem creation failed:', errorData);
      
      // Check if it's an AppBundle setup issue
      if (errorData.errors && errorData.errors.some((e: any) => e.title?.includes('activity') || e.title?.includes('appbundle'))) {
        throw new Error('Design Automation AppBundle not configured. Please complete AppBundle setup first - see docs/DesignAutomationSetup.md');
      }
      
      throw new Error(`Failed to create WorkItem: ${workItemResponse.status} - ${JSON.stringify(errorData)}`);
    }

    const workItem = await workItemResponse.json();
    const workItemId = workItem.id;
    
    console.log('WorkItem created:', workItemId);

    // Step 7: Poll for completion
    console.log('Step 7: Polling for WorkItem completion...');
    
    let status = 'pending';
    let attempts = 0;
    const maxAttempts = 60; // 10 minutes max
    
    while (status === 'pending' || status === 'inprogress') {
      if (attempts++ > maxAttempts) {
        throw new Error('WorkItem timeout after 10 minutes');
      }
      
      await new Promise(resolve => setTimeout(resolve, 10000)); // Wait 10s
      
      const statusResponse = await fetch(
        `https://developer.api.autodesk.com/da/us-east/v3/workitems/${workItemId}`,
        { headers: { 'Authorization': `Bearer ${twoLeggedToken}` } }
      );
      
      if (!statusResponse.ok) {
        throw new Error(`Failed to check WorkItem status: ${statusResponse.status}`);
      }
      
      const statusData = await statusResponse.json();
      status = statusData.status;
      
      console.log(`WorkItem status [${attempts}/${maxAttempts}]: ${status}`);
      
      if (status === 'failedInstructions' || status === 'failedUpload' || status === 'failedDownload') {
        console.error('WorkItem failed:', statusData);
        throw new Error(`WorkItem failed: ${status} - Check DA logs at: ${statusData.reportUrl}`);
      }
    }

    if (status !== 'success') {
      throw new Error(`WorkItem completed with unexpected status: ${status}`);
    }

    console.log('WorkItem completed successfully!');

    // Step 8: Download the modified file
    console.log('Step 8: Downloading modified file...');
    
    const modifiedFileResponse = await fetch(
      `https://developer.api.autodesk.com/oss/v2/buckets/${bucketKeyTemp}/objects/${outputObjectKey}`,
      { headers: { 'Authorization': `Bearer ${twoLeggedToken}` } }
    );

    if (!modifiedFileResponse.ok) {
      throw new Error(`Failed to download modified file: ${modifiedFileResponse.status}`);
    }

    const modifiedFile = await modifiedFileResponse.blob();
    console.log('Modified file downloaded, size:', modifiedFile.size, 'bytes');

    // Step 9: Upload modified file back to ACC storage
    console.log('Step 9: Uploading modified file back to ACC...');
    
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
      throw new Error(`Failed to create storage: ${createStorageResponse.status} - ${errorText}`);
    }

    const newStorageData = await createStorageResponse.json();
    const newStorageId = newStorageData.data.id;
    
    console.log('New storage created:', newStorageId);

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
      throw new Error(`Failed to upload modified file to ACC: ${uploadModifiedResponse.status}`);
    }

    console.log('Modified file uploaded to ACC storage');

    // Step 10: Create new version in ACC
    console.log('Step 10: Creating new version in ACC...');
    
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
      throw new Error(`Failed to create new version: ${newVersionResponse.status} - ${errorText}`);
    }

    const newVersion = await newVersionResponse.json();
    console.log('New version created:', newVersion.data.id);

    // Success!
    return new Response(
      JSON.stringify({
        success: true,
        message: 'Element transformations applied successfully! New version created in ACC.',
        transformsApplied: transforms.length,
        versionId: newVersion.data.id,
        workItemId: workItemId
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
        details: 'Check edge function logs for more information'
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});
