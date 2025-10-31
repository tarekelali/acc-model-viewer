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
    console.log('🔍 Fetching SSA service user email...');

    // Get 2-legged OAuth token using SSA credentials
    const clientSecret = Deno.env.get('AUTODESK_SSA_CLIENT_SECRET');
    
    console.log('🔑 SSA_CLIENT_ID exists:', !!SSA_CLIENT_ID);
    console.log('🔑 clientSecret exists:', !!clientSecret);
    console.log('🔑 clientSecret value (first 10 chars):', clientSecret ? clientSecret.substring(0, 10) : 'NONE');

    if (!SSA_CLIENT_ID || !clientSecret) {
      throw new Error(`Missing Autodesk SSA credentials - clientId: ${!!SSA_CLIENT_ID}, secret: ${!!clientSecret}`);
    }

    console.log('🔐 Getting 2-legged token with account:read scope...');

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
          scope: 'account:read',
        }),
      }
    );

    console.log('🔍 Token response status:', tokenResponse.status);
    
    if (!tokenResponse.ok) {
      const error = await tokenResponse.text();
      console.error('❌ Token request failed:', error);
      throw new Error(`Failed to get token: ${error}`);
    }

    const tokenData = await tokenResponse.json();
    const accessToken = tokenData.access_token;
    console.log('✅ Token acquired with account:read scope');
    console.log('🎫 Token (first 20 chars):', accessToken ? accessToken.substring(0, 20) : 'NONE');

    // Call the GET service-accounts endpoint to get the SSA user email
    const serviceAccountsUrl = `https://developer.api.autodesk.com/aps/admin/v1/service-accounts`;
    console.log('📡 Calling GET:', serviceAccountsUrl);
    console.log('🔑 Using Authorization header with token');

    const serviceAccountsResponse = await fetch(serviceAccountsUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    console.log('📊 Service accounts response status:', serviceAccountsResponse.status);
    console.log('📋 Response headers:', Object.fromEntries(serviceAccountsResponse.headers.entries()));

    if (!serviceAccountsResponse.ok) {
      const error = await serviceAccountsResponse.text();
      console.error('❌ Service accounts request failed (status ' + serviceAccountsResponse.status + '):', error);
      throw new Error(`Failed to fetch service accounts: ${serviceAccountsResponse.status} ${error}`);
    }

    const serviceAccountData = await serviceAccountsResponse.json();
    console.log('✅ FULL SERVICE ACCOUNTS RESPONSE:', JSON.stringify(serviceAccountData, null, 2));
    
    // Try multiple ways to extract the email
    const email = serviceAccountData.email || 
                  serviceAccountData.data?.email || 
                  serviceAccountData.data?.[0]?.email ||
                  'Email not found in response';
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
