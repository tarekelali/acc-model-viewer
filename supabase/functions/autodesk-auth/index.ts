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
    const clientId = "UonGGAilCryEuzl6kCD2owAcIiFZXobglVyZamHkTktJg2AY";
    const clientSecret = Deno.env.get('AUTODESK_CLIENT_SECRET');
    const redirectUri = `${Deno.env.get('SUPABASE_URL')}/functions/v1/autodesk-auth/callback`;

    const url = new URL(req.url);
    const code = url.searchParams.get('code');

    // If no code, redirect to Autodesk OAuth
    if (!code) {
      const authUrl = `https://developer.api.autodesk.com/authentication/v2/authorize?` +
        `response_type=code&` +
        `client_id=${clientId}&` +
        `redirect_uri=${encodeURIComponent(redirectUri)}&` +
        `scope=data:read data:write viewables:read`;

      return new Response(null, {
        status: 302,
        headers: {
          ...corsHeaders,
          'Location': authUrl,
        },
      });
    }

    // Exchange code for token
    const tokenResponse = await fetch('https://developer.api.autodesk.com/authentication/v2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: code,
        client_id: clientId,
        client_secret: clientSecret!,
        redirect_uri: redirectUri,
      }),
    });

    const tokenData = await tokenResponse.json();
    console.log('Token response:', tokenData);

    // Redirect back to app with token
    const appUrl = `${url.origin}/viewer?token=${tokenData.access_token}&refresh=${tokenData.refresh_token}&expires=${tokenData.expires_in}`;
    
    return new Response(null, {
      status: 302,
      headers: {
        ...corsHeaders,
        'Location': appUrl,
      },
    });
  } catch (error) {
    console.error('Auth error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
