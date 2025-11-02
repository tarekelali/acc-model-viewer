import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SSA_CLIENT_ID = "DfARgfaBERc4spAWY2UOoKBKLH475EKX372DBiy0r9tYTKeL";

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('🔍 Fetching SSA email using application:service_account:read scope...');

    // Get client secret from environment
    const clientSecret = Deno.env.get('AUTODESK_SSA_CLIENT_SECRET');
    
    console.log('🔑 SSA_CLIENT_ID exists:', !!SSA_CLIENT_ID);
    console.log('🔑 clientSecret exists:', !!clientSecret);

    if (!SSA_CLIENT_ID || !clientSecret) {
      throw new Error(`Missing Autodesk SSA credentials - clientId: ${!!SSA_CLIENT_ID}, secret: ${!!clientSecret}`);
    }

    // Step 1: Get 2-legged token with application:service_account:read scope
    console.log('🔐 Getting 2-legged token with application:service_account:read scope...');
    console.log('📍 Endpoint: POST https://developer.api.autodesk.com/authentication/v2/token');

    const tokenResponse = await fetch(
      'https://developer.api.autodesk.com/authentication/v2/token',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          client_id: SSA_CLIENT_ID,
          client_secret: clientSecret,
          grant_type: 'client_credentials',
          scope: 'application:service_account:read',
        }),
      }
    );

    console.log('🔍 Token response status:', tokenResponse.status);
    const tokenResponseText = await tokenResponse.text();
    console.log('🔍 Token response:', tokenResponseText);
    
    if (!tokenResponse.ok) {
      console.error('❌ Token request failed - Status:', tokenResponse.status);
      console.error('❌ Error details:', tokenResponseText);
      
      try {
        const errorJson = JSON.parse(tokenResponseText);
        throw new Error(`Token request failed (${tokenResponse.status}): ${JSON.stringify(errorJson)}`);
      } catch (parseError) {
        throw new Error(`Token request failed (${tokenResponse.status}): ${tokenResponseText}`);
      }
    }

    const tokenData = JSON.parse(tokenResponseText);
    const accessToken = tokenData.access_token;
    console.log('✅ Token acquired successfully');
    console.log('🎫 Access token (first 30 chars):', accessToken ? accessToken.substring(0, 30) : 'NONE');
    console.log('⏱️ Token expires in:', tokenData.expires_in, 'seconds');

    // Step 2: Call GET /authentication/v2/service-accounts
    const serviceAccountsUrl = 'https://developer.api.autodesk.com/authentication/v2/service-accounts';
    console.log('📡 Calling GET:', serviceAccountsUrl);
    console.log('🔑 Authorization: Bearer', accessToken.substring(0, 20) + '...');

    const serviceAccountsResponse = await fetch(serviceAccountsUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    console.log('📊 Service accounts response status:', serviceAccountsResponse.status);
    console.log('📊 Response status text:', serviceAccountsResponse.statusText);
    
    const responseHeaders = Object.fromEntries(serviceAccountsResponse.headers.entries());
    console.log('📋 Response headers:', JSON.stringify(responseHeaders, null, 2));

    const responseText = await serviceAccountsResponse.text();
    console.log('📄 Raw response body:', responseText);

    if (!serviceAccountsResponse.ok) {
      console.error('❌ Service accounts request failed');
      console.error('❌ Status:', serviceAccountsResponse.status, serviceAccountsResponse.statusText);
      console.error('❌ Body:', responseText);
      
      throw new Error(`GET /authentication/v2/service-accounts failed (${serviceAccountsResponse.status}): ${responseText}`);
    }

    // Parse the successful response
    const serviceAccountData = JSON.parse(responseText);
    console.log('✅ FULL SERVICE ACCOUNTS RESPONSE:', JSON.stringify(serviceAccountData, null, 2));
    
    // Extract email - try multiple possible paths
    let email = 'Email not found in response';
    
    if (serviceAccountData.email) {
      email = serviceAccountData.email;
    } else if (Array.isArray(serviceAccountData)) {
      email = serviceAccountData[0]?.email || email;
    } else if (serviceAccountData.data) {
      if (Array.isArray(serviceAccountData.data)) {
        email = serviceAccountData.data[0]?.email || email;
      } else {
        email = serviceAccountData.data.email || email;
      }
    }
    
    console.log('📧 Extracted SSA service account email:', email);

    return new Response(
      JSON.stringify({
        email: email,
        fullResponse: serviceAccountData
      }),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );

  } catch (error) {
    console.error('❌ Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
