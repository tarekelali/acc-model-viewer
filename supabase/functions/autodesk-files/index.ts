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
    const { token, projectId, folderId } = await req.json();

    console.log('Fetching files for project:', projectId);
    
    // Ensure project ID has 'b.' prefix
    const formattedProjectId = projectId.startsWith('b.') ? projectId : `b.${projectId}`;

    // First, get the project details to find its hub
    const projectUrl = `https://developer.api.autodesk.com/project/v1/hubs`;
    const hubsResponse = await fetch(projectUrl, {
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });

    const hubsData = await hubsResponse.json();
    console.log('Hubs response:', hubsData);
    
    if (!hubsData.data || hubsData.data.length === 0) {
      return new Response(JSON.stringify({ error: 'No hubs found', data: [], included: [] }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Use the first hub (or find the right one)
    const hubId = hubsData.data[0].id;
    console.log('Using hub:', hubId);

    // Get project top folders
    const foldersUrl = `https://developer.api.autodesk.com/project/v1/hubs/${hubId}/projects/${formattedProjectId}/topFolders`;
    
    console.log('Fetching folders from:', foldersUrl);

    const foldersResponse = await fetch(foldersUrl, {
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });

    const foldersData = await foldersResponse.json();
    console.log('Folders response:', foldersData);

    if (!foldersData.data || foldersData.data.length === 0) {
      return new Response(JSON.stringify({ error: 'No folders found', data: [], included: [] }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get contents of first folder
    const firstFolder = foldersData.data[0];
    const folderUrn = firstFolder.id;
    
    const contentsUrl = `https://developer.api.autodesk.com/data/v1/projects/${formattedProjectId}/folders/${folderUrn}/contents`;
    
    console.log('Fetching contents from:', contentsUrl);

    const contentsResponse = await fetch(contentsUrl, {
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });

    const contentsData = await contentsResponse.json();
    console.log('Contents response:', contentsData);

    return new Response(JSON.stringify(contentsData), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Files error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
