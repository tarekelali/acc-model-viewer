import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { token, projectId, versionUrn } = await req.json();

    console.log('Checking storage for version:', versionUrn);
    
    // Ensure project ID has 'b.' prefix
    const formattedProjectId = projectId.startsWith('b.') ? projectId : `b.${projectId}`;

    // Step 1: Get version storage relationships
    const storageUrl = `https://developer.api.autodesk.com/data/v1/projects/${formattedProjectId}/versions/${encodeURIComponent(versionUrn)}/relationships/storage`;
    
    console.log('Fetching storage relationships from:', storageUrl);

    const storageResponse = await fetch(storageUrl, {
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });

    if (!storageResponse.ok) {
      const errorText = await storageResponse.text();
      console.error('Storage API error:', storageResponse.status, errorText);
      return new Response(JSON.stringify({ 
        error: 'Failed to get storage relationships',
        status: storageResponse.status,
        details: errorText
      }), {
        status: storageResponse.status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const storageData = await storageResponse.json();
    console.log('Storage relationships:', JSON.stringify(storageData, null, 2));

    // Extract OSS URN from storage data
    const storageUrn = storageData.data?.id;
    if (!storageUrn) {
      return new Response(JSON.stringify({ 
        error: 'No storage URN found',
        storageData
      }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log('Storage URN:', storageUrn);

    // Parse the URN to extract bucket key and object key
    // Format: urn:adsk.objects:os.object:wip.dm.prod/BUCKET_KEY/OBJECT_ID
    const urnParts = storageUrn.split('/');
    const bucketKey = urnParts[urnParts.length - 2];
    const objectKey = urnParts[urnParts.length - 1];

    console.log('Extracted - Bucket:', bucketKey, 'Object:', objectKey);

    // Step 2: Check object permissions using OSS API
    const ossPermissionsUrl = `https://developer.api.autodesk.com/oss/v2/buckets/${bucketKey}/objects/${objectKey}/details`;
    
    console.log('Checking OSS permissions:', ossPermissionsUrl);

    const ossResponse = await fetch(ossPermissionsUrl, {
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });

    const ossPermissionsResult: any = {
      status: ossResponse.status,
      statusText: ossResponse.statusText,
      accessible: ossResponse.ok
    };

    let ossDetails = null;
    if (ossResponse.ok) {
      ossDetails = await ossResponse.json();
      console.log('OSS object details:', JSON.stringify(ossDetails, null, 2));
    } else {
      const errorText = await ossResponse.text();
      console.error('OSS permissions error:', ossResponse.status, errorText);
      ossPermissionsResult.error = errorText;
    }

    // Step 3: Try to generate a signed URL
    const signedUrlUrl = `https://developer.api.autodesk.com/oss/v2/buckets/${bucketKey}/objects/${objectKey}/signeds3download`;
    
    console.log('Attempting to generate signed URL:', signedUrlUrl);

    const signedUrlResponse = await fetch(signedUrlUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });

    const signedUrlResult: any = {
      status: signedUrlResponse.status,
      statusText: signedUrlResponse.statusText,
      canGenerateSignedUrl: signedUrlResponse.ok
    };

    if (signedUrlResponse.ok) {
      const signedUrlData = await signedUrlResponse.json();
      console.log('Signed URL generated successfully');
      signedUrlResult.url = signedUrlData.signedUrl || signedUrlData.url;
    } else {
      const errorText = await signedUrlResponse.text();
      console.error('Signed URL error:', signedUrlResponse.status, errorText);
      signedUrlResult.error = errorText;
    }

    // Return comprehensive analysis
    return new Response(JSON.stringify({ 
      storageUrn,
      bucketKey,
      objectKey,
      ossPermissions: ossPermissionsResult,
      ossDetails,
      signedUrlTest: signedUrlResult,
      analysis: {
        hasStorageAccess: storageResponse.ok,
        canReadOSSDetails: ossResponse.ok,
        canGenerateSignedUrl: signedUrlResponse.ok,
        recommendation: signedUrlResponse.ok 
          ? 'SSA app has full access to download the file'
          : 'SSA app lacks permissions - file may need to be re-uploaded using SSA credentials'
      }
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Storage check error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
