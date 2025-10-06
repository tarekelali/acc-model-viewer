import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { FolderTree, ZoomIn, ZoomOut, RotateCcw, Layers, LogIn } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

declare global {
  interface Window {
    Autodesk: any;
  }
}

interface Project {
  id: string;
  attributes: {
    name: string;
  };
}

const Viewer = () => {
  const viewerRef = useRef<HTMLDivElement>(null);
  const [viewer, setViewer] = useState<any>(null);
  const [showFileBrowser, setShowFileBrowser] = useState(true);
  const [searchParams] = useSearchParams();
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(false);
  const [manualProjectId, setManualProjectId] = useState("");
  
  // Target project to prioritize
  const TARGET_PROJECT_ID = "98278c51-84f5-4955-90c3-cfd337c8b225";
  
  // Helper to extract project ID from URL or return as-is
  const extractProjectId = (input: string): string => {
    // If it's a URL, extract the project ID
    if (input.includes('acc.autodesk.com') || input.includes('http')) {
      const match = input.match(/projects\/([a-f0-9-]+)/i);
      if (match) return match[1];
    }
    // Otherwise return as-is (already a project ID)
    return input.trim();
  };

  // Check for auth callback
  useEffect(() => {
    console.log('Checking for auth token...');
    const token = searchParams.get('token');
    
    if (token) {
      console.log('Token found in URL:', token.substring(0, 20) + '...');
      setAccessToken(token);
      localStorage.setItem('autodesk_token', token);
      toast.success("Authentication successful");
    } else {
      const savedToken = localStorage.getItem('autodesk_token');
      if (savedToken) {
        console.log('Using saved token:', savedToken.substring(0, 20) + '...');
        setAccessToken(savedToken);
      } else {
        console.log('No token found');
      }
    }
  }, [searchParams]);

  // Fetch projects when authenticated
  useEffect(() => {
    if (accessToken) {
      fetchProjects();
    }
  }, [accessToken]);

  const fetchProjects = async () => {
    setLoading(true);
    console.log('Fetching projects with token:', accessToken?.substring(0, 20) + '...');
    
    try {
      const { data, error } = await supabase.functions.invoke('autodesk-projects', {
        body: { token: accessToken },
      });

      console.log('Projects response:', { data, error });

      if (error) {
        console.error('Supabase function error:', error);
        toast.error(`Error: ${error.message}`);
        return;
      }
      
      const allProjects = data.data || [];
      
      // Sort projects to put target project first
      const sortedProjects = allProjects.sort((a: Project, b: Project) => {
        const aId = a.id.replace('b.', '');
        const bId = b.id.replace('b.', '');
        
        if (aId === TARGET_PROJECT_ID) return -1;
        if (bId === TARGET_PROJECT_ID) return 1;
        return 0;
      });
      
      setProjects(sortedProjects);
      toast.success(`Loaded ${sortedProjects.length} projects`);
      
      // Auto-load target project if found
      const targetProject = sortedProjects.find((p: Project) => 
        p.id.replace('b.', '') === TARGET_PROJECT_ID
      );
      
      if (targetProject) {
        console.log('Auto-loading target project:', targetProject.attributes.name);
        setTimeout(() => loadModel(targetProject.id), 1000);
      }
    } catch (error) {
      console.error('Error fetching projects:', error);
      toast.error(`Failed to load projects: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = () => {
    const authUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/autodesk-auth`;
    console.log('Opening auth URL in new tab:', authUrl);
    
    // Open in new tab to avoid iframe restrictions
    const authWindow = window.open(authUrl, '_blank');
    
    if (!authWindow) {
      toast.error('Popup blocked - please allow popups for this site');
      // Fallback: try direct navigation
      window.top!.location.href = authUrl;
    } else {
      toast('Opening Autodesk login...');
    }
  };

  // Initialize viewer
  useEffect(() => {
    if (!viewerRef.current || !window.Autodesk || !accessToken) {
      console.log('Viewer init skipped:', { 
        hasRef: !!viewerRef.current, 
        hasAutodesk: !!window.Autodesk, 
        hasToken: !!accessToken 
      });
      return;
    }

    console.log('Initializing Autodesk Viewer...');

    const options = {
      env: "AutodeskProduction",
      api: "derivativeV2",
      getAccessToken: async (callback: (token: string, expires: number) => void) => {
        try {
          console.log('Getting viewer token...');
          const { data, error } = await supabase.functions.invoke('autodesk-viewer-token');
          
          console.log('Viewer token response:', { data, error });
          
          if (error) {
            console.error('Viewer token error:', error);
            toast.error(`Token error: ${error.message}`);
            return;
          }
          
          callback(data.access_token, data.expires_in);
        } catch (error) {
          console.error('Token error:', error);
          toast.error(`Failed to get viewer token: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      },
    };

    window.Autodesk.Viewing.Initializer(options, () => {
      const viewerDiv = viewerRef.current;
      if (viewerDiv) {
        console.log('Creating viewer instance...');
        const viewer3D = new window.Autodesk.Viewing.GuiViewer3D(viewerDiv);
        viewer3D.start();
        setViewer(viewer3D);
        console.log('Viewer initialized successfully');
        toast.success("Viewer initialized");
      }
    });

    return () => {
      if (viewer) {
        console.log('Cleaning up viewer...');
        viewer.finish();
      }
    };
  }, [accessToken]);

  const loadModel = async (input: string) => {
    const projectId = extractProjectId(input);
    console.log('Loading files for project:', projectId);
    
    if (!viewer) {
      console.error('Viewer not initialized');
      toast.error("Viewer not initialized");
      return;
    }

    try {
      toast('Loading project files...');
      
      // Get project files
      const { data: filesData, error: filesError } = await supabase.functions.invoke('autodesk-files', {
        body: { 
          token: accessToken,
          projectId: projectId,
        },
      });

      console.log('Files response:', filesData);

      if (filesError) {
        console.error('Files error:', filesError);
        toast.error(`Failed to load files: ${filesError.message}`);
        return;
      }

      // Find first viewable item (looking for supported formats)
      const items = filesData.data || filesData.included || [];
      const viewableItem = items.find((item: any) => {
        const ext = item.attributes?.displayName?.toLowerCase() || '';
        return ext.includes('.rvt') || ext.includes('.ifc') || ext.includes('.nwd') || 
               ext.includes('.dwg') || ext.includes('.dwf');
      });

      if (!viewableItem) {
        console.error('No viewable files found');
        toast.error('No viewable 3D models found in this project');
        return;
      }

      console.log('Loading viewable item:', viewableItem);
      
      // Get the tip (latest) version URN
      const tipVersionUrn = viewableItem.relationships?.tip?.data?.id;
      
      if (!tipVersionUrn) {
        console.error('No tip version found');
        toast.error('File has no versions');
        return;
      }

      console.log('Fetching version details for:', tipVersionUrn);
      
      // Get the version details to access derivatives
      const { data: versionData, error: versionError } = await supabase.functions.invoke('autodesk-files', {
        body: { 
          token: accessToken,
          versionUrn: tipVersionUrn,
        },
      });

      console.log('Version response:', versionData);

      if (versionError || !versionData) {
        console.error('Version error:', versionError);
        toast.error('Failed to load file version');
        return;
      }

      // Get the URN for the model from the version's derivatives
      const derivativeUrn = versionData.relationships?.derivatives?.data?.id;
      
      if (!derivativeUrn) {
        console.error('No derivative URN found in version');
        toast.error('Model not processed for viewing');
        return;
      }

      const documentId = 'urn:' + derivativeUrn;
      console.log('Loading document:', documentId);
      
      window.Autodesk.Viewing.Document.load(
        documentId,
        (doc: any) => {
          console.log('Document loaded successfully:', doc);
          const defaultModel = doc.getRoot().getDefaultGeometry();
          viewer.loadDocumentNode(doc, defaultModel);
          toast.success(`Model loaded: ${viewableItem.attributes.displayName}`);
        },
        (error: any) => {
          console.error('Model load error:', error);
          toast.error(`Failed to load model (error ${error})`);
        }
      );
    } catch (error) {
      console.error('Load error:', error);
      toast.error(`Error loading model: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const handleZoomIn = () => {
    if (viewer) {
      viewer.navigation.setZoom(viewer.navigation.getCamera().fov * 0.9);
    }
  };

  const handleZoomOut = () => {
    if (viewer) {
      viewer.navigation.setZoom(viewer.navigation.getCamera().fov * 1.1);
    }
  };

  const handleResetView = () => {
    if (viewer) {
      viewer.navigation.setRequestHomeView(true);
      toast("View reset");
    }
  };

  return (
    <div className="flex h-screen bg-background">
      {/* Sidebar */}
      <aside
        className={`transition-all duration-300 ${
          showFileBrowser ? "w-80" : "w-0"
        } overflow-hidden border-r border-border bg-card`}
      >
        <div className="p-4 border-b border-border">
          <h2 className="text-lg font-semibold text-foreground">ACC Projects</h2>
        </div>
        <div className="p-4 space-y-4">
          {/* Manual Project ID Input */}
          {accessToken && (
            <div className="space-y-2 pb-4 border-b border-border">
              <label className="text-sm font-medium text-foreground">Quick Load Project</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={manualProjectId}
                  onChange={(e) => setManualProjectId(e.target.value)}
                  placeholder="Paste project ID or URL..."
                  className="flex-1 h-9 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                />
                <Button
                  onClick={() => {
                    if (manualProjectId.trim()) {
                      loadModel(manualProjectId);
                    }
                  }}
                  disabled={!manualProjectId.trim()}
                  size="sm"
                >
                  Load
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">Accepts project ID or full ACC URL</p>
            </div>
          )}
          
          {!accessToken ? (
            <Button onClick={handleLogin} className="w-full" size="sm">
              <LogIn className="h-4 w-4 mr-2" />
              Sign in with Autodesk
            </Button>
          ) : loading ? (
            <p className="text-sm text-muted-foreground">Loading projects...</p>
          ) : projects.length > 0 ? (
            projects.map((project) => {
              const isTarget = project.id.replace('b.', '') === TARGET_PROJECT_ID;
              return (
                <div
                  key={project.id}
                  onClick={() => loadModel(project.id)}
                  className={`p-3 rounded-lg cursor-pointer transition-colors ${
                    isTarget 
                      ? 'bg-primary/10 hover:bg-primary/20 border border-primary/30' 
                      : 'bg-secondary hover:bg-secondary/80'
                  }`}
                >
                  <p className="text-sm font-medium text-foreground">
                    {project.attributes.name}
                    {isTarget && <span className="ml-2 text-xs text-primary">(Target)</span>}
                  </p>
                </div>
              );
            })
          ) : (
            <p className="text-sm text-muted-foreground">No projects found</p>
          )}
        </div>
      </aside>

      {/* Main Viewer */}
      <main className="flex-1 flex flex-col">
        {/* Toolbar */}
        <div className="h-16 border-b border-border bg-card flex items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setShowFileBrowser(!showFileBrowser)}
              className="hover:bg-secondary"
            >
              <FolderTree className="h-5 w-5" />
            </Button>
            <h1 className="text-lg font-semibold text-foreground ml-2">
              Model Viewer
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={handleZoomIn}
              className="hover:bg-secondary"
            >
              <ZoomIn className="h-5 w-5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleZoomOut}
              className="hover:bg-secondary"
            >
              <ZoomOut className="h-5 w-5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleResetView}
              className="hover:bg-secondary"
            >
              <RotateCcw className="h-5 w-5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="hover:bg-secondary"
            >
              <Layers className="h-5 w-5" />
            </Button>
          </div>
        </div>

        {/* Viewer Container */}
        <div className="flex-1 relative">
          <div
            ref={viewerRef}
            className="absolute inset-0"
            style={{ backgroundColor: "hsl(var(--background))" }}
          />
          {!accessToken && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="text-center">
                <p className="text-muted-foreground text-sm">
                  Sign in with Autodesk to view your ACC projects
                </p>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default Viewer;
