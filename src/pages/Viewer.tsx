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

  // Check for auth callback
  useEffect(() => {
    const token = searchParams.get('token');
    if (token) {
      setAccessToken(token);
      localStorage.setItem('autodesk_token', token);
      toast.success("Authentication successful");
    } else {
      const savedToken = localStorage.getItem('autodesk_token');
      if (savedToken) {
        setAccessToken(savedToken);
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
    try {
      const { data, error } = await supabase.functions.invoke('autodesk-projects', {
        body: { token: accessToken },
      });

      if (error) throw error;
      
      setProjects(data.data || []);
      toast.success(`Loaded ${data.data?.length || 0} projects`);
    } catch (error) {
      console.error('Error fetching projects:', error);
      toast.error("Failed to load projects");
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = () => {
    const authUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/autodesk-auth`;
    window.location.href = authUrl;
  };

  // Initialize viewer
  useEffect(() => {
    if (!viewerRef.current || !window.Autodesk || !accessToken) return;

    const options = {
      env: "AutodeskProduction",
      api: "derivativeV2",
      getAccessToken: async (callback: (token: string, expires: number) => void) => {
        try {
          const { data } = await supabase.functions.invoke('autodesk-viewer-token');
          callback(data.access_token, data.expires_in);
        } catch (error) {
          console.error('Token error:', error);
          toast.error("Failed to get viewer token");
        }
      },
    };

    window.Autodesk.Viewing.Initializer(options, () => {
      const viewerDiv = viewerRef.current;
      if (viewerDiv) {
        const viewer3D = new window.Autodesk.Viewing.GuiViewer3D(viewerDiv);
        viewer3D.start();
        setViewer(viewer3D);
        toast.success("Viewer initialized");
      }
    });

    return () => {
      if (viewer) {
        viewer.finish();
      }
    };
  }, [accessToken]);

  const loadModel = async (projectId: string) => {
    if (!viewer) {
      toast.error("Viewer not initialized");
      return;
    }

    try {
      // For demo: Load a sample URN - you'll need to implement file browsing
      const documentId = 'urn:dXJuOmFkc2sud2lwcHJvZDpmcy5maWxlOnZmLnJMbllRdFEwV1dpT3Z0aXZiR2RNcFE_dmVyc2lvbj0x';
      
      window.Autodesk.Viewing.Document.load(
        documentId,
        (doc: any) => {
          const defaultModel = doc.getRoot().getDefaultGeometry();
          viewer.loadDocumentNode(doc, defaultModel);
          toast.success("Model loaded");
        },
        (error: any) => {
          console.error('Model load error:', error);
          toast.error("Failed to load model");
        }
      );
    } catch (error) {
      console.error('Load error:', error);
      toast.error("Error loading model");
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
        <div className="p-4 space-y-2">
          {!accessToken ? (
            <Button onClick={handleLogin} className="w-full" size="sm">
              <LogIn className="h-4 w-4 mr-2" />
              Sign in with Autodesk
            </Button>
          ) : loading ? (
            <p className="text-sm text-muted-foreground">Loading projects...</p>
          ) : projects.length > 0 ? (
            projects.map((project) => (
              <div
                key={project.id}
                onClick={() => loadModel(project.id)}
                className="p-3 rounded-lg bg-secondary hover:bg-secondary/80 cursor-pointer transition-colors"
              >
                <p className="text-sm font-medium text-foreground">{project.attributes.name}</p>
              </div>
            ))
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
