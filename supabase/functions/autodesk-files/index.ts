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

    // Helper function to recursively search folders for files
    const searchFolderForFiles = async (folderUrn: string, depth = 0): Promise<any[]> => {
      if (depth > 3) return []; // Limit recursion depth
      
      const contentsUrl = `https://developer.api.autodesk.com/data/v1/projects/${formattedProjectId}/folders/${folderUrn}/contents`;
      
      const contentsResponse = await fetch(contentsUrl, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      const contentsData = await contentsResponse.json();
      
      if (!contentsData.data) return [];
      
      const files: any[] = [];
      const folders: any[] = [];
      
      // Separate files and folders
      for (const item of contentsData.data) {
        if (item.type === 'items') {
          files.push(item);
        } else if (item.type === 'folders') {
          folders.push(item);
        }
      }
      
      console.log(`Folder ${folderUrn} - Found ${files.length} files, ${folders.length} subfolders`);
      
      // If we found files, return them
      if (files.length > 0) {
        return files;
      }
      
      // Otherwise, search subfolders
      for (const folder of folders) {
        const subFiles = await searchFolderForFiles(folder.id, depth + 1);
        if (subFiles.length > 0) {
          return subFiles;
        }
      }
      
      return [];
    };

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

    // Search through folders to find files
    let allFiles: any[] = [];
    
    for (const folder of foldersData.data) {
      console.log(`Searching folder: ${folder.attributes.name}`);
      const files = await searchFolderForFiles(folder.id);
      allFiles = allFiles.concat(files);
      
      // If we found files, we can stop searching
      if (allFiles.length > 0) break;
    }

    console.log(`Total files found: ${allFiles.length}`);

    return new Response(JSON.stringify({ 
      data: allFiles,
      included: []
    }), {
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
