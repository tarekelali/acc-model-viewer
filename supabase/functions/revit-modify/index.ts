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
    
    console.log('Got download URL');

    // Step 4: Download the Revit file
    console.log('Step 4: Downloading Revit file...');
    const fileResponse = await fetch(downloadUrl);
    if (!fileResponse.ok) {
      throw new Error(`Failed to download file: ${fileResponse.status}`);
    }
    
    const fileBlob = await fileResponse.blob();
    console.log('File downloaded, size:', fileBlob.size, 'bytes');

    // Step 5: Get client ID and aliases for Design Automation
    const clientId = "UonGGAilCryEuzl6kCD2owAcIiFZXobglVyZamHkTktJg2AY";
    const appBundleAlias = Deno.env.get('DA_APPBUNDLE_ALIAS') || `${clientId}.RevitTransformPlugin+prod`;
    const activityAlias = Deno.env.get('DA_ACTIVITY_ALIAS') || `${clientId}.TransformActivity+prod`;
    
    console.log('Using AppBundle:', appBundleAlias);
    console.log('Using Activity:', activityAlias);

    // Step 6: Upload input file to OSS for Design Automation
    console.log('Step 6: Uploading file to OSS...');
    
    const bucketKeyTemp = `revit_temp_${Date.now()}`;
    
    // Create temporary bucket
    const createBucketResponse = await fetch(
      'https://developer.api.autodesk.com/oss/v2/buckets',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
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

    // Upload input file
    const inputObjectKey = 'input.rvt';
    const uploadResponse = await fetch(
      `https://developer.api.autodesk.com/oss/v2/buckets/${bucketKeyTemp}/objects/${inputObjectKey}`,
      {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/octet-stream'
        },
        body: fileBlob
      }
    );

    if (!uploadResponse.ok) {
      throw new Error(`Failed to upload input file: ${uploadResponse.status}`);
    }

    const uploadDataResult = await uploadResponse.json();
    console.log('Input file uploaded:', uploadDataResult.objectId);

    // Get signed URLs for input and output
    const inputSignedResponse = await fetch(
      `https://developer.api.autodesk.com/oss/v2/buckets/${bucketKeyTemp}/objects/${inputObjectKey}/signeds3download`,
      { headers: { 'Authorization': `Bearer ${token}` } }
    );
    
    const inputSignedData = await inputSignedResponse.json();
    const inputSignedUrl = inputSignedData.url;

    const outputObjectKey = 'output.rvt';
    const outputSignedResponse = await fetch(
      `https://developer.api.autodesk.com/oss/v2/buckets/${bucketKeyTemp}/objects/${outputObjectKey}/signeds3upload`,
      { headers: { 'Authorization': `Bearer ${token}` } }
    );
    
    const outputSignedData = await outputSignedResponse.json();
    const outputSignedUrl = outputSignedData.url;

    // Step 7: Create WorkItem
    console.log('Step 7: Creating Design Automation WorkItem...');
    
    const transformsJson = JSON.stringify({ transforms });
    const transformsDataUrl = `data:application/json,${encodeURIComponent(transformsJson)}`;

    const workItemPayload = {
      activityId: activityAlias,
      arguments: {
        inputRvt: {
          url: inputSignedUrl,
          verb: 'get'
        },
        transforms: {
          url: transformsDataUrl,
          verb: 'get'
        },
        outputRvt: {
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
          'Authorization': `Bearer ${token}`,
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

    // Step 8: Poll for completion
    console.log('Step 8: Polling for WorkItem completion...');
    
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
        { headers: { 'Authorization': `Bearer ${token}` } }
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

    // Step 9: Download the modified file
    console.log('Step 9: Downloading modified file...');
    
    const modifiedFileResponse = await fetch(
      `https://developer.api.autodesk.com/oss/v2/buckets/${bucketKeyTemp}/objects/${outputObjectKey}`,
      { headers: { 'Authorization': `Bearer ${token}` } }
    );

    if (!modifiedFileResponse.ok) {
      throw new Error(`Failed to download modified file: ${modifiedFileResponse.status}`);
    }

    const modifiedFile = await modifiedFileResponse.blob();
    console.log('Modified file downloaded, size:', modifiedFile.size, 'bytes');

    // Step 10: Upload modified file back to ACC storage
    console.log('Step 10: Uploading modified file back to ACC...');
    
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

    // Step 11: Create new version in ACC
    console.log('Step 11: Creating new version in ACC...');
    
    const versionPayload = {
      jsonapi: { version: '1.0' },
      data: {
        type: 'versions',
        attributes: {
          name: itemData.data.attributes.displayName,
          extension: {
            type: 'versions:autodesk.bim360:File',
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
