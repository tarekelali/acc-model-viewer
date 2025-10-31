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
    const { accountId } = await req.json();

    if (!accountId) {
      return new Response(
        JSON.stringify({ error: 'Account ID is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('🔍 Fetching service users for account:', accountId);

    // Get 2-legged OAuth token using SSA credentials
    const clientSecret = Deno.env.get('AUTODESK_SSA_CLIENT_SECRET');
    
    console.log('🔑 SSA_CLIENT_ID exists:', !!SSA_CLIENT_ID);
    console.log('🔑 clientSecret exists:', !!clientSecret);
    console.log('🔑 clientSecret value (first 10 chars):', clientSecret ? clientSecret.substring(0, 10) : 'NONE');

    if (!SSA_CLIENT_ID || !clientSecret) {
      throw new Error(`Missing Autodesk SSA credentials - clientId: ${!!SSA_CLIENT_ID}, secret: ${!!clientSecret}`);
    }

    console.log('🔐 Getting 2-legged token...');

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

    if (!tokenResponse.ok) {
      const error = await tokenResponse.text();
      console.error('❌ Token request failed:', error);
      throw new Error(`Failed to get token: ${error}`);
    }

    const tokenData = await tokenResponse.json();
    const accessToken = tokenData.access_token;
    console.log('✅ Token acquired');

    // Call the users endpoint (service users should be included here)
    const usersUrl = `https://developer.api.autodesk.com/hq/v1/accounts/${accountId}/users`;
    console.log('📡 Calling:', usersUrl);

    const usersResponse = await fetch(usersUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (!usersResponse.ok) {
      const error = await usersResponse.text();
      console.error('❌ Users request failed:', error);
      throw new Error(`Failed to fetch users: ${usersResponse.status} ${error}`);
    }

    const usersData = await usersResponse.json();
    console.log('✅ Users retrieved, total:', usersData.length || 0);
    
    // Filter to find service users (those with email containing the client ID or app name)
    const serviceUsers = usersData.filter((user: any) => 
      user.email && (
        user.email.includes('DfARgfaBERc4spAWY2UOoKBKLH475EKX372DBiy0r9tYTKeL') ||
        user.email.toLowerCase().includes('m&cp-configurator') ||
        user.email.toLowerCase().includes('service') ||
        user.role === 'service_account'
      )
    );
    
    console.log('🔍 Found service users:', serviceUsers.length);
    console.log('📧 Service user details:', JSON.stringify(serviceUsers, null, 2));

    return new Response(
      JSON.stringify({
        totalUsers: usersData.length || 0,
        serviceUsers: serviceUsers,
        allUsers: usersData
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
