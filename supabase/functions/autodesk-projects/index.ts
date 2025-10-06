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
    const { token } = await req.json();

    // Get hubs (accounts)
    const hubsResponse = await fetch('https://developer.api.autodesk.com/project/v1/hubs', {
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });

    const hubsData = await hubsResponse.json();
    console.log('Hubs response:', hubsData);

    // Get projects from first hub
    const hubId = hubsData.data[0]?.id;
    if (!hubId) {
      throw new Error('No hubs found');
    }

    const projectsResponse = await fetch(`https://developer.api.autodesk.com/project/v1/hubs/${hubId}/projects`, {
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });

    const projectsData = await projectsResponse.json();
    console.log('Projects response:', projectsData);

    return new Response(JSON.stringify(projectsData), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Projects error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
