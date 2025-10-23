import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// SECURITY: Whitelist of allowed project IDs
const ALLOWED_PROJECT_ID = 'd27a6383-5881-4756-9cff-3deccd318427';

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

    // SECURITY: Filter to only return the whitelisted project
    const filteredProjects = (projectsData.data || []).filter((project: any) => {
      const projectId = project.id.replace('b.', '');
      return projectId === ALLOWED_PROJECT_ID;
    });

    console.log(`Filtered from ${projectsData.data?.length || 0} to ${filteredProjects.length} projects (whitelist: ${ALLOWED_PROJECT_ID})`);

    return new Response(JSON.stringify({ 
      data: filteredProjects,
      links: projectsData.links 
    }), {
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
