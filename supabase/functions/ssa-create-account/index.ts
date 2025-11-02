const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const clientId = 'DfARgfaBERc4spAWY2UOoKBKLH475EKX372DBiy0r9tYTKeL';
    const clientSecret = Deno.env.get('AUTODESK_SSA_CLIENT_SECRET');

    if (!clientSecret) {
      console.error('❌ AUTODESK_SSA_CLIENT_SECRET not found');
      return new Response(
        JSON.stringify({ error: 'SSA client secret not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('🔐 Getting 2-legged token with application:service_account:write scope...');
    console.log('🔑 SSA_CLIENT_ID:', clientId);
    console.log('📍 Endpoint: POST https://developer.api.autodesk.com/authentication/v2/token');

    // Step 1: Get 2-legged token with WRITE scope
    const tokenParams = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'client_credentials',
      scope: 'application:service_account:write',
    });

    const tokenResponse = await fetch('https://developer.api.autodesk.com/authentication/v2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: tokenParams,
    });

    console.log('🔍 Token response status:', tokenResponse.status);

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error('❌ Token acquisition failed:', errorText);
      return new Response(
        JSON.stringify({ error: 'Failed to get access token', details: errorText }),
        { status: tokenResponse.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const tokenData = await tokenResponse.json();
    const accessToken = tokenData.access_token;

    console.log('✅ Token acquired successfully');
    console.log('🎫 Access token (first 30 chars):', accessToken.substring(0, 30));
    console.log('⏱️ Token expires in:', tokenData.expires_in, 'seconds');

    // Step 2: Create the service account
    console.log('📡 Calling POST: https://developer.api.autodesk.com/authentication/v2/service-accounts');
    console.log('🔑 Authorization: Bearer', accessToken.substring(0, 20) + '...');

    const createAccountBody = {
      name: 'servicemcpconfigurator',
      firstName: 'service',
      lastName: 'mcpconfigurator',
    };

    console.log('📝 Request body:', JSON.stringify(createAccountBody));

    const createAccountResponse = await fetch('https://developer.api.autodesk.com/authentication/v2/service-accounts', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(createAccountBody),
    });

    console.log('📊 Create account response status:', createAccountResponse.status);
    console.log('📊 Response status text:', createAccountResponse.statusText);

    const responseText = await createAccountResponse.text();
    console.log('📄 Raw response body:', responseText);

    let responseData;
    try {
      responseData = JSON.parse(responseText);
    } catch (e) {
      console.error('❌ Failed to parse response as JSON:', e);
      responseData = { rawResponse: responseText };
    }

    console.log('✅ FULL CREATE RESPONSE:', JSON.stringify(responseData, null, 2));

    if (!createAccountResponse.ok) {
      console.error('❌ Service account creation failed');
      return new Response(
        JSON.stringify({ 
          error: 'Failed to create service account', 
          status: createAccountResponse.status,
          details: responseData 
        }),
        { status: createAccountResponse.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Extract email from response
    let email = 'Email not found in response';
    
    if (responseData.email) {
      email = responseData.email;
    } else if (responseData.serviceAccount?.email) {
      email = responseData.serviceAccount.email;
    } else if (responseData.data?.email) {
      email = responseData.data.email;
    }

    console.log('📧 Extracted SSA service account email:', email);

    return new Response(
      JSON.stringify({ 
        success: true,
        email,
        fullResponse: responseData 
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('❌ Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
