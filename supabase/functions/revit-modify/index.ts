// Enhanced error handling and logging - v2025-10-16
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// SECURITY: Whitelist of allowed project IDs
const ALLOWED_PROJECT_ID = 'd27a6383-5881-4756-9cff-3deccd318427';

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

/**
 * Downloads a file from ACC using the correct authentication approach
 * @param userToken - User's access token (may include "Bearer " prefix)
 * @param storageUrn - Storage URN from ACC (e.g., urn:adsk.objects:os.object:wip.dm.prod/uuid.rvt)
 * @returns Promise<ArrayBuffer> - The downloaded file content
 */
async function downloadFileFromACC(userToken: string, storageUrn: string): Promise<ArrayBuffer> {
  console.log('[DOWNLOAD] Starting ACC file download');
  console.log('[DOWNLOAD] Storage URN:', storageUrn);
  
  // Step 1: Strip "Bearer " prefix if present to avoid duplication
  const cleanToken = userToken.replace(/^Bearer\s+/i, '');
  console.log('[DOWNLOAD] Token cleaned (first 20 chars):', cleanToken.substring(0, 20) + '...');
  
  // Step 2: Parse storage URN to extract bucket key and object key
  // Format: urn:adsk.objects:os.object:wip.dm.prod/09a1c38e-d203-411a-b4f4-c3824260b1c5.rvt
  console.log('[DOWNLOAD] Parsing storage URN...');
  
  const urnParts = storageUrn.split(':');
  const bucketAndObject = urnParts[urnParts.length - 1]; // Get last part: "wip.dm.prod/uuid.rvt"
  const [bucketKey, ...objectKeyParts] = bucketAndObject.split('/');
  const objectKey = objectKeyParts.join('/'); // Rejoin in case object key has slashes
  
  console.log('[DOWNLOAD] Parsed - Bucket:', bucketKey, 'Object:', objectKey);
  
  // Step 3: Get signed download URL using OSS API with user's token
  console.log('[DOWNLOAD] Requesting signed download URL...');
  
  const encodedObjectKey = encodeURIComponent(objectKey);
  const signedUrlEndpoint = `https://developer.api.autodesk.com/oss/v2/buckets/${bucketKey}/objects/${encodedObjectKey}/signeds3download`;
  
  console.log('[DOWNLOAD] Signed URL endpoint:', signedUrlEndpoint);
  console.log('[DOWNLOAD] Using USER token for signed URL request');
  
  let signedUrlResponse;
  try {
    signedUrlResponse = await fetch(signedUrlEndpoint, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${cleanToken}`, // Use user's token
      }
    });
  } catch (e) {
    console.error('[DOWNLOAD] Network error getting signed URL:', e);
    throw new Error(`Network error while getting signed download URL: ${e instanceof Error ? e.message : String(e)}`);
  }
  
  if (!signedUrlResponse.ok) {
    const errorText = await signedUrlResponse.text();
    console.error('[DOWNLOAD] Failed to get signed URL. Status:', signedUrlResponse.status);
    console.error('[DOWNLOAD] Error response:', errorText);
    throw new Error(`Failed to get signed download URL (${signedUrlResponse.status}): ${errorText}`);
  }
  
  const signedUrlData = await signedUrlResponse.json();
  const downloadUrl = signedUrlData.url;
  
  if (!downloadUrl) {
    console.error('[DOWNLOAD] No URL in response:', signedUrlData);
    throw new Error('No download URL in signed URL response');
  }
  
  console.log('[DOWNLOAD] ✓ Signed download URL obtained');
  console.log('[DOWNLOAD] Signed URL (first 50 chars):', downloadUrl.substring(0, 50) + '...');
  
  // Step 4: Download the file using the signed URL (no auth header needed)
  console.log('[DOWNLOAD] Downloading file content from signed URL...');
  
  let fileResponse;
  try {
    fileResponse = await fetch(downloadUrl, {
      method: 'GET',
      // No Authorization header needed for signed S3 URL
    });
  } catch (e) {
    console.error('[DOWNLOAD] Network error downloading file:', e);
    throw new Error(`Network error while downloading file: ${e instanceof Error ? e.message : String(e)}`);
  }
  
  if (!fileResponse.ok) {
    const errorText = await fileResponse.text();
    console.error('[DOWNLOAD] Failed to download file. Status:', fileResponse.status);
    console.error('[DOWNLOAD] Error response:', errorText);
    throw new Error(`Failed to download file from signed URL (${fileResponse.status}): ${errorText}`);
  }
  
  const fileBuffer = await fileResponse.arrayBuffer();
  console.log('[DOWNLOAD] ✓ File downloaded successfully. Size:', fileBuffer.byteLength, 'bytes');
  
  return fileBuffer;
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

    const { token, projectId, itemId, folderUrn, transforms, ossBucket, ossObject } = requestBody;
    
    // Use token from body, or fallback to headers
    const effectiveToken = token || customAuthHeader || authHeader?.replace('Bearer ', '');
    
    // Log incoming request fields
    console.log('📥 Request data fields:', {
      hasToken: !!token,
      hasProjectId: !!projectId,
      hasItemId: !!itemId,
      hasFolderUrn: !!folderUrn,
      hasTransforms: !!transforms,
      transformsType: typeof transforms,
      transformsKeys: transforms ? Object.keys(transforms) : [],
      hasOssCoordinates: !!(ossBucket && ossObject),
      ossBucket: ossBucket || 'NOT PROVIDED',
      ossObject: ossObject || 'NOT PROVIDED',
      allFieldNames: Object.keys(requestBody)
    });
    
    console.log('[INPUT] Request parameters:', {
      hasTokenInBody: !!token,
      hasAuthHeader: !!authHeader,
      hasCustomAuthHeader: !!customAuthHeader,
      hasEffectiveToken: !!effectiveToken,
      projectId,
      itemId,
      folderUrn,
      transformCount: transforms ? Object.keys(transforms).length : 0,
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

    // SECURITY: Validate project ID against whitelist
    const cleanProjectId = projectId.replace('b.', '');
    if (cleanProjectId !== ALLOWED_PROJECT_ID) {
      console.error(`[SECURITY] Access denied: Project ${cleanProjectId} not in whitelist (allowed: ${ALLOWED_PROJECT_ID})`);
      return createErrorResponse(
        ErrorType.AUTH_ERROR,
        `Access denied: This project is not authorized. Only project ${ALLOWED_PROJECT_ID} is allowed.`,
        'Security Validation',
        403,
        { requestedProject: cleanProjectId, allowedProject: ALLOWED_PROJECT_ID }
      );
    }
    console.log(`[SECURITY] ✅ Project ${cleanProjectId} validated against whitelist`);

    if (!itemId) {
      return createErrorResponse(
        ErrorType.VALIDATION_ERROR,
        'Missing itemId parameter',
        'Input Validation',
        400
      );
    }

    // Validate transforms as object/map (not array)
    if (!transforms || typeof transforms !== 'object' || Array.isArray(transforms)) {
      return createErrorResponse(
        ErrorType.VALIDATION_ERROR,
        'transforms must be a non-empty object/map',
        'Input Validation',
        400,
        { receivedTransforms: transforms, receivedType: typeof transforms }
      );
    }

    const transformKeys = Object.keys(transforms);
    
    // Validate OSS coordinates are provided (required to avoid memory limits)
    if (!ossBucket || !ossObject) {
      return createErrorResponse(
        ErrorType.VALIDATION_ERROR,
        'Missing OSS coordinates (ossBucket and ossObject). Please use the "SSA Re-upload" button first to upload the file to an OSS bucket. This avoids memory limits when processing large files.',
        'Input Validation',
        400,
        { 
          hint: 'Click the "SSA Re-upload" button in the UI before saving transformations',
          requiredFields: ['ossBucket', 'ossObject'],
          received: { ossBucket: ossBucket || 'MISSING', ossObject: ossObject || 'MISSING' }
        }
      );
    }
    if (transformKeys.length === 0) {
      return createErrorResponse(
        ErrorType.VALIDATION_ERROR,
        'transforms object is empty',
        'Input Validation',
        400,
        { receivedTransforms: transforms }
      );
    }

    // Validate transform structure (each element should have positions)
    for (const elementId of transformKeys) {
      const t = transforms[elementId];
      if (!t.originalPosition || !t.newPosition ||
          typeof t.originalPosition.x !== 'number' || typeof t.originalPosition.y !== 'number' || typeof t.originalPosition.z !== 'number' ||
          typeof t.newPosition.x !== 'number' || typeof t.newPosition.y !== 'number' || typeof t.newPosition.z !== 'number') {
        return createErrorResponse(
          ErrorType.VALIDATION_ERROR,
          `Invalid transform structure for element ${elementId}. Must include originalPosition and newPosition with x,y,z coordinates.`,
          'Input Validation',
          400,
          { elementId, transform: t }
        );
      }
    }

    console.log('[VALIDATED] All inputs valid, proceeding with workflow');

    // ========== STEP 0: GET 2-LEGGED TOKENS (Regular + SSA) ==========
    const clientId = 'UonGGAilCryEuzl6kCD2owAcIiFZXobglVyZamHkTktJg2AY';
    const clientSecret = Deno.env.get('AUTODESK_CLIENT_SECRET');
    const ssaClientId = 'DfARgfaBERc4spAWY2UOoKBKLH475EKX372DBiy0r9tYTKeL';
    const ssaClientSecret = Deno.env.get('AUTODESK_SSA_CLIENT_SECRET');
    
    if (!clientSecret) {
      return createErrorResponse(
        ErrorType.AUTH_ERROR,
        'AUTODESK_CLIENT_SECRET not configured in environment',
        'Environment Check',
        500
      );
    }

    if (!ssaClientSecret) {
      return createErrorResponse(
        ErrorType.AUTH_ERROR,
        'AUTODESK_SSA_CLIENT_SECRET not configured in environment',
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
    console.log('[REVIT-MODIFY] ✅ Regular token:', twoLeggedToken.substring(0, 20) + '...');

    // ========== STEP 0B: GET SSA TOKEN FOR OSS DOWNLOAD ==========
    console.log('[STEP 0B] Getting SSA 2-legged token for OSS file download...');
    
    let ssaTokenResponse;
    try {
      ssaTokenResponse = await fetch('https://developer.api.autodesk.com/authentication/v2/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: ssaClientId,
          client_secret: ssaClientSecret,
          scope: 'data:read data:write bucket:read',
        }),
      });
    } catch (e) {
      return createErrorResponse(
        ErrorType.AUTH_ERROR,
        'Network error while fetching SSA token',
        'SSA Token Acquisition',
        500,
        { error: e instanceof Error ? e.message : String(e) }
      );
    }

    if (!ssaTokenResponse.ok) {
      const error = await ssaTokenResponse.text();
      return createErrorResponse(
        ErrorType.AUTH_ERROR,
        'Failed to get SSA token from Autodesk',
        'SSA Token Acquisition',
        ssaTokenResponse.status,
        { response: error }
      );
    }

    const ssaTokenData = await ssaTokenResponse.json();
    const ssaToken = ssaTokenData.access_token;
    
    if (!ssaToken) {
      return createErrorResponse(
        ErrorType.AUTH_ERROR,
        'No access token in SSA authentication response',
        'SSA Token Acquisition',
        500,
        { ssaTokenData }
      );
    }

    console.log('[STEP 0B] ✓ SSA token acquired successfully');
    console.log('[REVIT-MODIFY] ✅ SSA token:', ssaToken.substring(0, 20) + '...');

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

    // ========== STEP 2: GET SIGNED DOWNLOAD URL FROM OSS (using provided coordinates) ==========
    console.log('[REVIT-MODIFY] Downloading file from OSS...');
    console.log('[REVIT-MODIFY]   - Bucket: revit-transform-temp');
    console.log('[REVIT-MODIFY]   - Object:', ossObject);
    
    // CRITICAL: Use Regular token for revit-transform-temp bucket
    const tokenToUse = twoLeggedToken; // Force regular token for OSS bucket
    console.log('[REVIT-MODIFY] ✅ Using REGULAR token for download');
    console.log('[REVIT-MODIFY]   - Token preview:', tokenToUse.substring(0, 30) + '...');
    
    // URL encode the object name to handle special characters like .rvt
    const encodedOssObject = encodeURIComponent(ossObject);
    const ossDownloadUrl = `https://developer.api.autodesk.com/oss/v2/buckets/${ossBucket}/objects/${encodedOssObject}/signeds3download`;
    console.log('[REVIT-MODIFY] Full download URL:', ossDownloadUrl);
    
    // Retry logic for eventual consistency
    const maxRetries = 5;
    const retryDelay = 3000; // 3 seconds
    let ossSignedData = null;
    let lastError = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      console.log(`[REVIT-MODIFY] Download attempt ${attempt}/${maxRetries}...`);
      
      try {
        const ossSignedUrlResponse = await fetch(ossDownloadUrl, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${tokenToUse}`,
            'Content-Type': 'application/json'
          }
        });

        console.log(`[REVIT-MODIFY] Attempt ${attempt} response status:`, ossSignedUrlResponse.status);

        if (ossSignedUrlResponse.ok) {
          ossSignedData = await ossSignedUrlResponse.json();
          console.log(`[REVIT-MODIFY] ✅ Success on attempt ${attempt}!`);
          break;
        }

        // If 404 and not last attempt, retry
        if (ossSignedUrlResponse.status === 404 && attempt < maxRetries) {
          const errorText = await ossSignedUrlResponse.text();
          console.log(`[REVIT-MODIFY] ⏳ 404 on attempt ${attempt}, retrying in ${retryDelay}ms...`);
          console.log(`[REVIT-MODIFY]    Error: ${errorText}`);
          lastError = errorText;
          await new Promise(resolve => setTimeout(resolve, retryDelay));
          continue;
        }

        // Non-404 error or last attempt
        const errorText = await ossSignedUrlResponse.text();
        console.error('[REVIT-MODIFY] ❌ Failed to get signed download URL');
        console.error('[REVIT-MODIFY]   - Status:', ossSignedUrlResponse.status);
        console.error('[REVIT-MODIFY]   - Error:', errorText);
        console.error('[REVIT-MODIFY]   - Token used: REGULAR');
        
        return createErrorResponse(
          ErrorType.API_ERROR,
          'Failed to get OSS signed download URL',
          'OSS Signed URL',
          ossSignedUrlResponse.status,
          { response: errorText, bucket: ossBucket, object: ossObject, url: ossDownloadUrl, attempt }
        );

      } catch (error) {
        if (attempt === maxRetries) {
          console.error('[REVIT-MODIFY] ❌ All retry attempts failed');
          return createErrorResponse(
            ErrorType.API_ERROR,
            `Failed after ${maxRetries} attempts. Last error: ${error instanceof Error ? error.message : String(error)}`,
            'OSS Signed URL',
            500,
            { error: error instanceof Error ? error.message : String(error), url: ossDownloadUrl }
          );
        }
        console.log(`[REVIT-MODIFY] ⚠️ Error on attempt ${attempt}:`, error instanceof Error ? error.message : String(error));
        lastError = error instanceof Error ? error.message : String(error);
        await new Promise(resolve => setTimeout(resolve, retryDelay));
      }
    }

    if (!ossSignedData) {
      return createErrorResponse(
        ErrorType.API_ERROR,
        `Failed after ${maxRetries} attempts. Last error: ${lastError}`,
        'OSS Signed URL',
        500,
        { lastError, url: ossDownloadUrl }
      );
    }

    const downloadUrl = ossSignedData.url;

    if (!downloadUrl) {
      return createErrorResponse(
        ErrorType.API_ERROR,
        'No signed URL in OSS response',
        'OSS Signed URL',
        500,
        { ossSignedData }
      );
    }

    console.log('[REVIT-MODIFY] ✅ Got signed download URL, downloading file...');

    // ========== STEP 3.5: CREATE TEMP BUCKET FOR OUTPUT ==========
    console.log('[STEP 3.5] Creating temporary bucket for output file...');
    
    const bucketKeyTemp = `revit_temp_${Date.now()}`;
    console.log('[STEP 3.5] Bucket key:', bucketKeyTemp);
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
        'Network error while creating temp bucket',
        'Create Temp Bucket',
        500,
        { error: e instanceof Error ? e.message : String(e) }
      );
    }

    // Bucket may already exist, which is fine (409 status)
    if (!createBucketResponse.ok && createBucketResponse.status !== 409) {
      const errorText = await createBucketResponse.text();
      return createErrorResponse(
        ErrorType.API_ERROR,
        'Failed to create temp bucket',
        'Create Temp Bucket',
        createBucketResponse.status,
        { response: errorText }
      );
    }

    console.log('[STEP 3.5] ✓ Temp bucket ready for output');

    // ========== STEP 4: VERIFY DESIGN AUTOMATION CONFIGURATION ==========
    console.log('[STEP 4] Verifying Design Automation configuration...');
    
    // CRITICAL: Use the actual deployed Activity/AppBundle IDs from Cursor deployment
    const appBundleAlias = `${clientId}.RevitTransformAppV2+1`;
    const activityAlias = `${clientId}.RevitTransformActivityV2+1`;
    
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

    // ========== STEP 5: GET OUTPUT FILE SIGNED URL ==========
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
    
    // Helper function to extract Revit Element ID from UniqueId
    // UniqueId format: "562f4fcd-297a-4420-acfc-2a688eda6533-0008eaa6"
    // Last segment (0008eaa6) is hex Revit Element ID → convert to decimal (584358)
    function extractRevitElementId(uniqueId: string): number {
      const parts = uniqueId.split('-');
      const hexId = parts[parts.length - 1]; // Last segment is the hex element ID
      return parseInt(hexId, 16); // Convert hex to decimal
    }
    
    // Convert transforms object to array format expected by C# plugin with camelCase
    const transformsArray = Object.entries(transforms).map(([uniqueId, transformData]: [string, any]) => {
      const revitElementId = extractRevitElementId(uniqueId);
      
      console.log(`[TRANSFORM] ${transformData.elementName}: uniqueId=${uniqueId} → elementId=${revitElementId}`);
      
      return {
        elementId: revitElementId,          // ✅ Use actual Revit Element ID (not Viewer dbId)
        uniqueId: uniqueId,                 // ✅ Also send uniqueId for reference
        elementName: transformData.elementName,
        originalPosition: {
          x: transformData.originalPosition.x,
          y: transformData.originalPosition.y,
          z: transformData.originalPosition.z
        },
        newPosition: {
          x: transformData.newPosition.x,
          y: transformData.newPosition.y,
          z: transformData.newPosition.z
        }
      };
    });
    
    const transformsJson = JSON.stringify({ transforms: transformsArray });
    console.log(`[STEP 5.5] Converted ${transformsArray.length} transform(s) to C# format`);
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
          method: 'GET',
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
    const transformsUrl = transformsData.url;

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
          verb: 'get',
          localName: 'input.rvt'
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
      },
      adskDebug: {
        uploadJobFolder: true
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
    console.log('[STEP 6] Returning immediately with WorkItem ID for client-side polling');

    const elapsed = Date.now() - startTime;

    // Return immediately with 202 Accepted
    return new Response(
      JSON.stringify({
        workItemId,
        bucketKeyTemp,
        outputObjectKey,
        status: 'pending',
        message: 'WorkItem created successfully. Poll /revit-status for updates.',
        elapsedMs: elapsed
      }),
      {
        status: 202,
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
