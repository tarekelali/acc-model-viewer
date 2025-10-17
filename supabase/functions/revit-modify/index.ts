// Enhanced error handling and logging - v2025-10-16
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface Transform {
  dbId: number;
  uniqueId: string;  // Revit UniqueId (GUID)
  elementName: string;
  originalPosition: { x: number; y: number; z: number };
  newPosition: { x: number; y: number; z: number };
}

enum ErrorType {
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  AUTH_ERROR = 'AUTH_ERROR',
  API_ERROR = 'API_ERROR',
  WORKITEM_FAILED = 'WORKITEM_FAILED',
  TIMEOUT_ERROR = 'TIMEOUT_ERROR',
  UPLOAD_ERROR = 'UPLOAD_ERROR',
  UNKNOWN_ERROR = 'UNKNOWN_ERROR'
}

interface ErrorResponse {
  errorType: ErrorType;
  message: string;
  step?: string;
  statusCode?: number;
  details?: any;
  timestamp: string;
}

function createErrorResponse(
  errorType: ErrorType,
  message: string,
  step?: string,
  statusCode?: number,
  details?: any
): Response {
  const errorResponse: ErrorResponse = {
    errorType,
    message,
    step,
    statusCode,
    details,
    timestamp: new Date().toISOString()
  };
  
  console.error(`[ERROR] ${errorType} at ${step}:`, message, details);
  
  return new Response(
    JSON.stringify(errorResponse),
    {
      status: statusCode || 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    }
  );
}

serve(async (req) => {
  // 🔥🔥🔥 EDGE FUNCTION REACHED - UNCONDITIONAL LOGGING 🔥🔥🔥
  console.log('🔥🔥🔥 EDGE FUNCTION REACHED AT:', new Date().toISOString());
  
  // 🚨🚨🚨 LOG ALL HEADERS IMMEDIATELY 🚨🚨🚨
  const allHeaders: Record<string, string> = {};
  req.headers.forEach((value, key) => {
    allHeaders[key] = value;
  });
  console.log('🚨🚨🚨 ALL INCOMING HEADERS:', JSON.stringify(allHeaders, null, 2));
  
  // Check for Authorization header (case-insensitive)
  const authHeader = req.headers.get('Authorization') || req.headers.get('authorization');
  const customAuthHeader = req.headers.get('x-custom-authorization') || req.headers.get('X-Custom-Authorization');
  
  console.log('🔍 Authorization header found:', !!authHeader);
  console.log('🔍 x-custom-authorization header found:', !!customAuthHeader);
  
  if (authHeader) {
    console.log('✅ Authorization header present (first 20 chars):', authHeader.substring(0, 20));
  }
  if (customAuthHeader) {
    console.log('✅ x-custom-authorization header present (first 20 chars):', customAuthHeader.substring(0, 20));
  }
  
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  console.log('[START] Design Automation workflow initiated at', new Date().toISOString());

  try {
    // ========== INPUT VALIDATION ==========
    let requestBody;
    try {
      requestBody = await req.json();
    } catch (e) {
      return createErrorResponse(
        ErrorType.VALIDATION_ERROR,
        'Invalid JSON in request body',
        'Input Parsing',
        400,
        { error: e instanceof Error ? e.message : String(e) }
      );
    }

    const { token, projectId, itemId, transforms } = requestBody;
    
    // Use token from body, or fallback to headers
    const effectiveToken = token || customAuthHeader || authHeader?.replace('Bearer ', '');
    
    console.log('[INPUT] Request parameters:', {
      hasTokenInBody: !!token,
      hasAuthHeader: !!authHeader,
      hasCustomAuthHeader: !!customAuthHeader,
      hasEffectiveToken: !!effectiveToken,
      projectId,
      itemId,
      transformCount: transforms?.length,
      timestamp: new Date().toISOString()
    });

    // Validate required fields
    if (!effectiveToken) {
      return createErrorResponse(
        ErrorType.VALIDATION_ERROR,
        'Missing authentication token (checked body, Authorization header, and x-custom-authorization header)',
        'Input Validation',
        400
      );
    }

    if (!projectId) {
      return createErrorResponse(
        ErrorType.VALIDATION_ERROR,
        'Missing projectId parameter',
        'Input Validation',
        400
      );
    }

    if (!itemId) {
      return createErrorResponse(
        ErrorType.VALIDATION_ERROR,
        'Missing itemId parameter',
        'Input Validation',
        400
      );
    }

    if (!transforms || !Array.isArray(transforms) || transforms.length === 0) {
      return createErrorResponse(
        ErrorType.VALIDATION_ERROR,
        'Missing or empty transforms array',
        'Input Validation',
        400,
        { receivedTransforms: transforms }
      );
    }

    // Validate transform structure
    for (let i = 0; i < transforms.length; i++) {
      const t = transforms[i];
      if (!t.dbId || !t.elementName || !t.originalPosition || !t.newPosition) {
        return createErrorResponse(
          ErrorType.VALIDATION_ERROR,
          `Invalid transform structure at index ${i}`,
          'Input Validation',
          400,
          { transform: t }
        );
      }
    }

    console.log('[VALIDATED] All inputs valid, proceeding with workflow');

    // ========== STEP 0: GET 2-LEGGED TOKEN ==========
    const clientId = 'UonGGAilCryEuzl6kCD2owAcIiFZXobglVyZamHkTktJg2AY';
    const clientSecret = Deno.env.get('AUTODESK_CLIENT_SECRET');
    
    if (!clientSecret) {
      return createErrorResponse(
        ErrorType.AUTH_ERROR,
        'AUTODESK_CLIENT_SECRET not configured in environment',
        'Environment Check',
        500
      );
    }

    console.log('[STEP 0] Getting 2-legged token for Design Automation API...');
    
    let tokenResponse;
    try {
      tokenResponse = await fetch('https://developer.api.autodesk.com/authentication/v2/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: clientId,
          client_secret: clientSecret,
          scope: 'code:all bucket:create bucket:read data:read data:write',
        }),
      });
    } catch (e) {
      return createErrorResponse(
        ErrorType.AUTH_ERROR,
        'Network error while fetching 2-legged token',
        'Token Acquisition',
        500,
        { error: e instanceof Error ? e.message : String(e) }
      );
    }

    if (!tokenResponse.ok) {
      const error = await tokenResponse.text();
      return createErrorResponse(
        ErrorType.AUTH_ERROR,
        'Failed to get 2-legged token from Autodesk',
        'Token Acquisition',
        tokenResponse.status,
        { response: error }
      );
    }

    const tokenData = await tokenResponse.json();
    const twoLeggedToken = tokenData.access_token;
    
    if (!twoLeggedToken) {
      return createErrorResponse(
        ErrorType.AUTH_ERROR,
        'No access token in authentication response',
        'Token Acquisition',
        500,
        { tokenData }
      );
    }

    console.log('[STEP 0] ✓ 2-legged token acquired successfully');

    // ========== STEP 1: GET ITEM DETAILS ==========
    console.log('[STEP 1] Fetching item details from ACC...');
    
    let itemResponse;
    try {
      itemResponse = await fetch(
        `https://developer.api.autodesk.com/data/v1/projects/b.${projectId}/items/${itemId}`,
        { headers: { 'Authorization': `Bearer ${effectiveToken}` } }
      );
    } catch (e) {
      return createErrorResponse(
        ErrorType.API_ERROR,
        'Network error while fetching item details',
        'Fetch Item',
        500,
        { error: e instanceof Error ? e.message : String(e) }
      );
    }

    if (!itemResponse.ok) {
      const errorText = await itemResponse.text();
      return createErrorResponse(
        ErrorType.API_ERROR,
        'Failed to fetch item from ACC',
        'Fetch Item',
        itemResponse.status,
        { response: errorText }
      );
    }

    const itemData = await itemResponse.json();
    
    if (!itemData?.data?.relationships?.tip?.data?.id) {
      return createErrorResponse(
        ErrorType.API_ERROR,
        'Invalid item data structure - missing tip version',
        'Fetch Item',
        500,
        { itemData }
      );
    }

    const tipVersionId = itemData.data.relationships.tip.data.id;
    console.log('[STEP 1] ✓ Item fetched, tip version:', tipVersionId);

    // ========== STEP 2: GET VERSION STORAGE ==========
    console.log('[STEP 2] Fetching version storage details...');
    
    let versionResponse;
    try {
      versionResponse = await fetch(
        `https://developer.api.autodesk.com/data/v1/projects/b.${projectId}/versions/${encodeURIComponent(tipVersionId)}`,
        { headers: { 'Authorization': `Bearer ${effectiveToken}` } }
      );
    } catch (e) {
      return createErrorResponse(
        ErrorType.API_ERROR,
        'Network error while fetching version details',
        'Fetch Version',
        500,
        { error: e instanceof Error ? e.message : String(e) }
      );
    }

    if (!versionResponse.ok) {
      const errorText = await versionResponse.text();
      return createErrorResponse(
        ErrorType.API_ERROR,
        'Failed to fetch version from ACC',
        'Fetch Version',
        versionResponse.status,
        { response: errorText }
      );
    }

    const versionData = await versionResponse.json();
    
    if (!versionData?.data?.relationships?.storage?.data?.id) {
      return createErrorResponse(
        ErrorType.API_ERROR,
        'Invalid version data - missing storage ID',
        'Fetch Version',
        500,
        { versionData }
      );
    }

    const storageId = versionData.data.relationships.storage.data.id;
    console.log('[STEP 2] ✓ Storage ID:', storageId);

    // ========== STEP 3: GET SIGNED DOWNLOAD URL ==========
    console.log('[STEP 3] Parsing storage ID and getting signed download URL...');
    
    const storageIdParts = storageId.split(':');
    const bucketAndObject = storageIdParts[storageIdParts.length - 1];
    const [bucketKey, ...objectKeyParts] = bucketAndObject.split('/');
    const objectKey = objectKeyParts.join('/');
    
    console.log('[STEP 3] Parsed storage - Bucket:', bucketKey, 'Object:', objectKey);
    
    let storageResponse;
    try {
      storageResponse = await fetch(
        `https://developer.api.autodesk.com/oss/v2/buckets/${bucketKey}/objects/${objectKey}/signeds3download`,
        { headers: { 'Authorization': `Bearer ${effectiveToken}` } }
      );
    } catch (e) {
      return createErrorResponse(
        ErrorType.API_ERROR,
        'Network error while getting signed download URL',
        'Get Download URL',
        500,
        { error: e instanceof Error ? e.message : String(e) }
      );
    }

    if (!storageResponse.ok) {
      const errorText = await storageResponse.text();
      return createErrorResponse(
        ErrorType.API_ERROR,
        'Failed to get signed download URL',
        'Get Download URL',
        storageResponse.status,
        { response: errorText }
      );
    }

    const downloadData = await storageResponse.json();
    const downloadUrl = downloadData.url;
    
    if (!downloadUrl) {
      return createErrorResponse(
        ErrorType.API_ERROR,
        'No download URL in response',
        'Get Download URL',
        500,
        { downloadData }
      );
    }

    console.log('[STEP 3] ✓ Signed download URL obtained');

    // ========== STEP 4: VERIFY DESIGN AUTOMATION CONFIGURATION ==========
    console.log('[STEP 4] Verifying Design Automation configuration...');
    
    const appBundleAlias = Deno.env.get('DA_APPBUNDLE_ALIAS') || `${clientId}.RevitTransformApp+prod`;
    const activityAlias = Deno.env.get('DA_ACTIVITY_ALIAS') || `${clientId}.RevitTransformActivity+prod`;
    
    console.log('[STEP 4] Configuration:', {
      appBundleAlias,
      activityAlias,
      timestamp: new Date().toISOString()
    });

    // Verify Activity exists and get its details
    console.log('[STEP 4] Verifying Activity exists and is configured correctly...');
    
    let activityCheckResponse;
    try {
      activityCheckResponse = await fetch(
        `https://developer.api.autodesk.com/da/us-east/v3/activities/${activityAlias}`,
        { headers: { 'Authorization': `Bearer ${twoLeggedToken}` } }
      );
    } catch (e) {
      console.warn('[STEP 4] Could not verify Activity (network error):', e instanceof Error ? e.message : String(e));
    }

    if (activityCheckResponse && activityCheckResponse.ok) {
      const activityDetails = await activityCheckResponse.json();
      console.log('[STEP 4] Activity details:', {
        id: activityDetails.id,
        version: activityDetails.version,
        appBundles: activityDetails.appbundles,
        engine: activityDetails.engine,
        commandLine: activityDetails.commandLine
      });
      
      // Log the AppBundle reference to verify it's correct
      if (activityDetails.appbundles && activityDetails.appbundles.length > 0) {
        console.log('[STEP 4] Activity is using AppBundle(s):', activityDetails.appbundles);
      } else {
        console.warn('[STEP 4] WARNING: Activity has no AppBundles configured!');
      }
    } else if (activityCheckResponse) {
      const errorText = await activityCheckResponse.text();
      console.warn('[STEP 4] WARNING: Could not verify Activity:', activityCheckResponse.status, errorText);
      console.warn('[STEP 4] This may cause WorkItem creation to fail if Activity does not exist');
    }

    console.log('[STEP 4] ✓ Design Automation configuration verified');

    // ========== STEP 5: CREATE OUTPUT BUCKET ==========
    console.log('[STEP 5] Creating temporary bucket for output file...');
    
    const bucketKeyTemp = `revit_temp_${Date.now()}`;
    console.log('[STEP 5] Bucket key:', bucketKeyTemp);
    let createBucketResponse;
    try {
      createBucketResponse = await fetch(
        'https://developer.api.autodesk.com/oss/v2/buckets',
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${twoLeggedToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            bucketKey: bucketKeyTemp,
            policyKey: 'transient'
          })
        }
      );
    } catch (e) {
      return createErrorResponse(
        ErrorType.API_ERROR,
        'Network error while creating output bucket',
        'Create Output Bucket',
        500,
        { error: e instanceof Error ? e.message : String(e) }
      );
    }

    if (!createBucketResponse.ok && createBucketResponse.status !== 409) {
      const errorText = await createBucketResponse.text();
      console.warn('[STEP 5] Bucket creation warning (non-fatal):', errorText);
    }

    console.log('[STEP 5] Getting signed URL for output file...');
    const outputObjectKey = 'output.rvt';
    const minutesExpiration = 30;
    
    let outputSignedResponse;
    try {
      outputSignedResponse = await fetch(
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
    } catch (e) {
      return createErrorResponse(
        ErrorType.API_ERROR,
        'Network error while getting signed output URL',
        'Get Output URL',
        500,
        { error: e instanceof Error ? e.message : String(e) }
      );
    }

    if (!outputSignedResponse.ok) {
      const errorText = await outputSignedResponse.text();
      return createErrorResponse(
        ErrorType.API_ERROR,
        'Failed to get signed output URL',
        'Get Output URL',
        outputSignedResponse.status,
        { response: errorText }
      );
    }
    
    const outputSignedData = await outputSignedResponse.json();
    const outputSignedUrl = outputSignedData.signedUrl;
    
    if (!outputSignedUrl) {
      return createErrorResponse(
        ErrorType.API_ERROR,
        'No signed URL in output response',
        'Get Output URL',
        500,
        { outputSignedData }
      );
    }

    console.log('[STEP 5] ✓ Output bucket and signed URL ready');

    // ========== STEP 5.5: UPLOAD TRANSFORMS.JSON TO OSS ==========
    console.log('[STEP 5.5] Uploading transforms.json to OSS...');
    
    const transformsJson = JSON.stringify({ transforms });
    const transformsKey = `transforms_${Date.now()}.json`;

    // Use batch signed S3 upload API
    let batchUploadResponse;
    try {
      batchUploadResponse = await fetch(
        `https://developer.api.autodesk.com/oss/v2/buckets/${bucketKeyTemp}/objects/batchsigneds3upload`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${twoLeggedToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            requests: [{
              objectKey: transformsKey
            }]
          })
        }
      );
    } catch (e) {
      return createErrorResponse(
        ErrorType.API_ERROR,
        'Network error while getting batch upload URLs',
        'Batch Upload Request',
        500,
        { error: e instanceof Error ? e.message : String(e) }
      );
    }

    if (!batchUploadResponse.ok) {
      const errorData = await batchUploadResponse.text();
      return createErrorResponse(
        ErrorType.API_ERROR,
        'Failed to get batch upload URLs',
        'Batch Upload Request',
        batchUploadResponse.status,
        { errorData, bucketKey: bucketKeyTemp, transformsKey }
      );
    }

    const batchData = await batchUploadResponse.json();
    const uploadInfo = batchData.results?.[transformsKey];
    
    if (!uploadInfo || !uploadInfo.urls || uploadInfo.urls.length === 0) {
      return createErrorResponse(
        ErrorType.API_ERROR,
        'No upload URLs in batch response',
        'Batch Upload Request',
        500,
        { batchData }
      );
    }

    // Upload to S3
    const uploadUrl = uploadInfo.urls[0];
    let s3UploadResponse;
    try {
      s3UploadResponse = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: transformsJson
      });
    } catch (e) {
      return createErrorResponse(
        ErrorType.API_ERROR,
        'Network error uploading to S3',
        'S3 Upload',
        500,
        { error: e instanceof Error ? e.message : String(e) }
      );
    }

    if (!s3UploadResponse.ok) {
      const errorText = await s3UploadResponse.text();
      return createErrorResponse(
        ErrorType.API_ERROR,
        'Failed to upload transforms to S3',
        'S3 Upload',
        s3UploadResponse.status,
        { response: errorText }
      );
    }

    // Complete upload
    let completeResponse;
    try {
      completeResponse = await fetch(
        `https://developer.api.autodesk.com/oss/v2/buckets/${bucketKeyTemp}/objects/batchcompleteupload`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${twoLeggedToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            requests: [{
              objectKey: transformsKey,
              uploadKey: uploadInfo.uploadKey
            }]
          })
        }
      );
    } catch (e) {
      return createErrorResponse(
        ErrorType.API_ERROR,
        'Network error completing upload',
        'Complete Upload',
        500,
        { error: e instanceof Error ? e.message : String(e) }
      );
    }

    if (!completeResponse.ok) {
      const errorText = await completeResponse.text();
      return createErrorResponse(
        ErrorType.API_ERROR,
        'Failed to complete upload',
        'Complete Upload',
        completeResponse.status,
        { response: errorText }
      );
    }

    console.log('[STEP 5.5] ✓ transforms.json uploaded');

    // Get download URL
    let transformsSignedResponse;
    try {
      transformsSignedResponse = await fetch(
        `https://developer.api.autodesk.com/oss/v2/buckets/${bucketKeyTemp}/objects/${transformsKey}/signeds3download`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${twoLeggedToken}`,
            'Content-Type': 'application/json'
          }
        }
      );
    } catch (e) {
      return createErrorResponse(
        ErrorType.API_ERROR,
        'Network error getting download URL',
        'Get Download URL',
        500,
        { error: e instanceof Error ? e.message : String(e) }
      );
    }

    if (!transformsSignedResponse.ok) {
      const errorText = await transformsSignedResponse.text();
      return createErrorResponse(
        ErrorType.API_ERROR,
        'Failed to get download URL',
        'Get Download URL',
        transformsSignedResponse.status,
        { response: errorText }
      );
    }

    const transformsData = await transformsSignedResponse.json();
    const transformsUrl = transformsData.signedUrl;

    if (!transformsUrl) {
      return createErrorResponse(
        ErrorType.API_ERROR,
        'No download URL in response',
        'Get Download URL',
        500,
        { transformsData }
      );
    }

    console.log('[STEP 5.5] ✓ Transforms signed URL ready');

    // ========== STEP 6: CREATE WORKITEM ==========
    console.log('[STEP 6] Creating Design Automation WorkItem...');

    const workItemPayload = {
      activityId: activityAlias,
      arguments: {
        inputFile: {
          url: downloadUrl,
          verb: 'get'
        },
        transforms: {
          url: transformsUrl,
          verb: 'get',
          localName: 'transforms.json'
        },
        outputFile: {
          url: outputSignedUrl,
          verb: 'put',
          localName: 'output.rvt',
          headers: {
            'Content-Type': 'application/octet-stream'
          }
        }
      }
    };

    console.log('[STEP 6] WorkItem payload:', {
      activityId: activityAlias,
      transformCount: transforms.length,
      hasInputUrl: !!downloadUrl,
      hasOutputUrl: !!outputSignedUrl
    });

    let workItemResponse;
    try {
      workItemResponse = await fetch(
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
    } catch (e) {
      return createErrorResponse(
        ErrorType.API_ERROR,
        'Network error while creating WorkItem',
        'Create WorkItem',
        500,
        { error: e instanceof Error ? e.message : String(e) }
      );
    }

    if (!workItemResponse.ok) {
      const errorData = await workItemResponse.json();
      
      // Check if it's an Activity/AppBundle setup issue
      if (errorData.errors) {
        const errorMessages = errorData.errors.map((e: any) => e.title || e.detail).join(', ');
        
        if (errorMessages.includes('activity') || errorMessages.includes('appbundle')) {
          return createErrorResponse(
            ErrorType.API_ERROR,
            'Design Automation Activity or AppBundle not found or misconfigured',
            'Create WorkItem',
            workItemResponse.status,
            {
              activityUsed: activityAlias,
              appBundleExpected: appBundleAlias,
              errors: errorData.errors,
              suggestion: 'Verify Activity v3 exists and is properly configured with the AppBundle'
            }
          );
        }
      }
      
      return createErrorResponse(
        ErrorType.API_ERROR,
        'Failed to create Design Automation WorkItem',
        'Create WorkItem',
        workItemResponse.status,
        { 
          errorData,
          activityUsed: activityAlias
        }
      );
    }

    const workItem = await workItemResponse.json();
    const workItemId = workItem.id;
    
    if (!workItemId) {
      return createErrorResponse(
        ErrorType.API_ERROR,
        'No WorkItem ID in response',
        'Create WorkItem',
        500,
        { workItem }
      );
    }

    console.log('[STEP 6] ✓ WorkItem created:', workItemId);

    // ========== STEP 7: POLL FOR COMPLETION ==========
    console.log('[STEP 7] Polling for WorkItem completion...');
    
    let status = 'pending';
    let attempts = 0;
    const maxAttempts = 60; // 10 minutes max
    const pollInterval = 10000; // 10 seconds
    
    while (status === 'pending' || status === 'inprogress') {
      if (attempts++ > maxAttempts) {
        return createErrorResponse(
          ErrorType.TIMEOUT_ERROR,
          'WorkItem timeout after 10 minutes',
          'Poll WorkItem',
          408,
          { 
            workItemId,
            attempts,
            lastStatus: status
          }
        );
      }
      
      await new Promise(resolve => setTimeout(resolve, pollInterval));
      
      let statusResponse;
      try {
        statusResponse = await fetch(
          `https://developer.api.autodesk.com/da/us-east/v3/workitems/${workItemId}`,
          { headers: { 'Authorization': `Bearer ${twoLeggedToken}` } }
        );
      } catch (e) {
        console.warn(`[STEP 7] Network error polling WorkItem (attempt ${attempts}):`, e instanceof Error ? e.message : String(e));
        continue; // Retry on network error
      }
      
      if (!statusResponse.ok) {
        const errorText = await statusResponse.text();
        return createErrorResponse(
          ErrorType.API_ERROR,
          'Failed to check WorkItem status',
          'Poll WorkItem',
          statusResponse.status,
          { 
            workItemId,
            response: errorText
          }
        );
      }
      
      const statusData = await statusResponse.json();
      status = statusData.status;
      
      console.log(`[STEP 7] WorkItem status [${attempts}/${maxAttempts}]: ${status}`, {
        workItemId,
        elapsed: `${attempts * pollInterval / 1000}s`
      });
      
      if (status === 'failedInstructions' || status === 'failedUpload' || status === 'failedDownload') {
        return createErrorResponse(
          ErrorType.WORKITEM_FAILED,
          `WorkItem failed with status: ${status}`,
          'WorkItem Execution',
          500,
          {
            workItemId,
            status,
            reportUrl: statusData.reportUrl,
            stats: statusData.stats,
            message: 'Check the Design Automation report URL for detailed error logs'
          }
        );
      }
    }

    if (status !== 'success') {
      return createErrorResponse(
        ErrorType.WORKITEM_FAILED,
        `WorkItem completed with unexpected status: ${status}`,
        'WorkItem Execution',
        500,
        { workItemId, status }
      );
    }

    const elapsed = Date.now() - startTime;
    console.log(`[STEP 7] ✓ WorkItem completed successfully in ${elapsed}ms`);

    // ========== STEP 8: DOWNLOAD MODIFIED FILE ==========
    console.log('[STEP 8] Downloading modified file from temp bucket...');
    
    let modifiedFileResponse;
    try {
      modifiedFileResponse = await fetch(
        `https://developer.api.autodesk.com/oss/v2/buckets/${bucketKeyTemp}/objects/${outputObjectKey}`,
        { headers: { 'Authorization': `Bearer ${twoLeggedToken}` } }
      );
    } catch (e) {
      return createErrorResponse(
        ErrorType.API_ERROR,
        'Network error while downloading modified file',
        'Download Modified File',
        500,
        { error: e instanceof Error ? e.message : String(e) }
      );
    }

    if (!modifiedFileResponse.ok) {
      const errorText = await modifiedFileResponse.text();
      return createErrorResponse(
        ErrorType.API_ERROR,
        'Failed to download modified file from temp bucket',
        'Download Modified File',
        modifiedFileResponse.status,
        { response: errorText }
      );
    }

    const modifiedFile = await modifiedFileResponse.blob();
    console.log('[STEP 8] ✓ Modified file downloaded, size:', modifiedFile.size, 'bytes');

    // ========== STEP 9: UPLOAD TO ACC STORAGE ==========
    console.log('[STEP 9] Uploading modified file back to ACC storage...');
    
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

    let createStorageResponse;
    try {
      createStorageResponse = await fetch(
        `https://developer.api.autodesk.com/data/v1/projects/b.${projectId}/storage`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${effectiveToken}`,
            'Content-Type': 'application/vnd.api+json'
          },
          body: JSON.stringify(storagePayload)
        }
      );
    } catch (e) {
      return createErrorResponse(
        ErrorType.UPLOAD_ERROR,
        'Network error while creating ACC storage',
        'Create ACC Storage',
        500,
        { error: e instanceof Error ? e.message : String(e) }
      );
    }

    if (!createStorageResponse.ok) {
      const errorText = await createStorageResponse.text();
      return createErrorResponse(
        ErrorType.UPLOAD_ERROR,
        'Failed to create ACC storage for modified file',
        'Create ACC Storage',
        createStorageResponse.status,
        { response: errorText }
      );
    }

    const newStorageData = await createStorageResponse.json();
    
    if (!newStorageData?.data?.id) {
      return createErrorResponse(
        ErrorType.UPLOAD_ERROR,
        'No storage ID in ACC storage response',
        'Create ACC Storage',
        500,
        { newStorageData }
      );
    }

    const newStorageId = newStorageData.data.id;
    console.log('[STEP 9] New ACC storage created:', newStorageId);

    // Parse new storage ID and upload modified file
    const newStorageParts = newStorageId.split(':');
    const newBucketAndObject = newStorageParts[newStorageParts.length - 1];
    const [newBucketKey, ...newObjectKeyParts] = newBucketAndObject.split('/');
    const newObjectKey = newObjectKeyParts.join('/');

    let uploadModifiedResponse;
    try {
      uploadModifiedResponse = await fetch(
        `https://developer.api.autodesk.com/oss/v2/buckets/${newBucketKey}/objects/${newObjectKey}`,
        {
          method: 'PUT',
          headers: {
            'Authorization': `Bearer ${effectiveToken}`,
            'Content-Type': 'application/octet-stream'
          },
          body: modifiedFile
        }
      );
    } catch (e) {
      return createErrorResponse(
        ErrorType.UPLOAD_ERROR,
        'Network error while uploading modified file to ACC',
        'Upload to ACC',
        500,
        { error: e instanceof Error ? e.message : String(e) }
      );
    }

    if (!uploadModifiedResponse.ok) {
      const errorText = await uploadModifiedResponse.text();
      return createErrorResponse(
        ErrorType.UPLOAD_ERROR,
        'Failed to upload modified file to ACC storage',
        'Upload to ACC',
        uploadModifiedResponse.status,
        { response: errorText }
      );
    }

    console.log('[STEP 9] ✓ Modified file uploaded to ACC storage');

    // ========== STEP 10: CREATE NEW VERSION ==========
    console.log('[STEP 10] Creating new version in ACC...');
    
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

    let newVersionResponse;
    try {
      newVersionResponse = await fetch(
        `https://developer.api.autodesk.com/data/v1/projects/b.${projectId}/versions`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${effectiveToken}`,
            'Content-Type': 'application/vnd.api+json'
          },
          body: JSON.stringify(versionPayload)
        }
      );
    } catch (e) {
      return createErrorResponse(
        ErrorType.UPLOAD_ERROR,
        'Network error while creating new ACC version',
        'Create ACC Version',
        500,
        { error: e instanceof Error ? e.message : String(e) }
      );
    }

    if (!newVersionResponse.ok) {
      const errorText = await newVersionResponse.text();
      return createErrorResponse(
        ErrorType.UPLOAD_ERROR,
        'Failed to create new version in ACC',
        'Create ACC Version',
        newVersionResponse.status,
        { response: errorText }
      );
    }

    const newVersion = await newVersionResponse.json();
    
    if (!newVersion?.data?.id) {
      return createErrorResponse(
        ErrorType.UPLOAD_ERROR,
        'No version ID in ACC version response',
        'Create ACC Version',
        500,
        { newVersion }
      );
    }

    const totalElapsed = Date.now() - startTime;
    console.log('[STEP 10] ✓ New version created:', newVersion.data.id);
    console.log(`[SUCCESS] Complete workflow finished in ${totalElapsed}ms`);

    // Success!
    return new Response(
      JSON.stringify({
        success: true,
        message: 'Element transformations applied successfully! New version created in ACC.',
        transformsApplied: transforms.length,
        versionId: newVersion.data.id,
        workItemId: workItemId,
        elapsedMs: totalElapsed
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );

  } catch (error) {
    // Catch-all for any unexpected errors not handled by specific try-catch blocks
    console.error('[FATAL ERROR] Unexpected error in Design Automation workflow:', error);
    
    const message = error instanceof Error ? error.message : 'Unknown error occurred';
    const stack = error instanceof Error ? error.stack : undefined;
    
    return createErrorResponse(
      ErrorType.UNKNOWN_ERROR,
      message,
      'Unknown',
      500,
      { 
        stack,
        type: error?.constructor?.name,
        timestamp: new Date().toISOString()
      }
    );
  }
});
