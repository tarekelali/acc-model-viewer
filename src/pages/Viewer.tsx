import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { FolderTree, ZoomIn, ZoomOut, RotateCcw, Layers, LogIn, Edit3, Save, X } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Card } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { 
  saveTokens, 
  getValidAccessToken, 
  startAuthFlow,
  clearTokens 
} from '@/lib/autodesk-auth';

declare global {
  interface Window {
    Autodesk: any;
    THREE: any;
  }
}

interface Project {
  id: string;
  attributes: {
    name: string;
  };
}

const Viewer = () => {
  // Target project to prioritize
  const TARGET_PROJECT_ID = "98278c51-84f5-4955-90c3-cfd337c8b225";
  
  // Hardcoded trial model URL
  const TRIAL_MODEL_URL = "https://acc.autodesk.com/docs/files/projects/98278c51-84f5-4955-90c3-cfd337c8b225?folderUrn=urn%3Aadsk.wipprod%3Afs.folder%3Aco.zr0cAH1lWP6TBbnZTaeKEg&entityId=urn%3Aadsk.wipprod%3Adm.lineage%3ArLnYQtQ0WwiOvtivbGdMpQ&viewModel=detail&moduleId=folders&viewableGuid=f45222b7-9a71-d2d4-9674-a73d51f2c767";
  
  const viewerRef = useRef<HTMLDivElement>(null);
  const transformExtensionRef = useRef<any>(null);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [viewer, setViewer] = useState<any>(null);
  const [showFileBrowser, setShowFileBrowser] = useState(true);
  const [searchParams] = useSearchParams();
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(false);
  const [manualProjectId, setManualProjectId] = useState(TRIAL_MODEL_URL);
  const [editMode, setEditMode] = useState(false);
  const [pendingChanges, setPendingChanges] = useState<Array<{
    dbId: number;
    originalPosition: { x: number; y: number; z: number };
    newPosition: { x: number; y: number; z: number };
    elementName: string;
  }>>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);
  const [currentItemId, setCurrentItemId] = useState<string | null>(null);
  const [showAuthPrompt, setShowAuthPrompt] = useState(false);
  
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

  // Check for auth callback or load stored tokens
  useEffect(() => {
    console.log('Checking for auth token...');
    const token = searchParams.get('token');
    const refresh = searchParams.get('refresh');
    const expires = searchParams.get('expires');
    
    if (token && refresh && expires) {
      console.log('New tokens received from auth callback');
      saveTokens(token, refresh, parseInt(expires));
      setAccessToken(token);
      setShowAuthPrompt(false);
      toast.success("Authentication successful - you're logged in for 14 days");
    } else {
      // Try to get valid token (will auto-refresh if needed)
      getValidAccessToken().then(token => {
        if (token) {
          console.log('Using valid access token from storage');
          setAccessToken(token);
          setShowAuthPrompt(false);
        } else {
          console.log('No valid token found, authentication required');
          setShowAuthPrompt(true);
        }
      });
    }
  }, [searchParams]);

  // Fetch projects when authenticated
  useEffect(() => {
    if (accessToken) {
      fetchProjects();
    }
  }, [accessToken]);

  const ensureValidToken = async (): Promise<string> => {
    const token = await getValidAccessToken();
    if (!token) {
      setShowAuthPrompt(true);
      throw new Error('Authentication required');
    }
    setAccessToken(token);
    return token;
  };

  const fetchProjects = async () => {
    setLoading(true);
    
    try {
      const token = await ensureValidToken();
      console.log('Fetching projects with valid token');
      
      const { data, error } = await supabase.functions.invoke('autodesk-projects', {
        body: { token },
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
        console.log('Auto-loading trial model:', targetProject.attributes.name);
        setTimeout(() => loadModel(TRIAL_MODEL_URL), 1000);
      }
    } catch (error) {
      console.error('Error fetching projects:', error);
      toast.error(`Failed to load projects: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = () => {
    startAuthFlow();
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
          console.log('Getting access token for viewer...');
          
          // For ACC files, use the user's 3-legged token instead of a 2-legged viewer token
          if (accessToken) {
            console.log('Using user access token for viewer');
            callback(accessToken, 3600);
          } else {
            console.error('No access token available');
            toast.error('Authentication required');
          }
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
    setCurrentProjectId(projectId);
    
    // Extract folderUrn and entityId from ACC URL if present
    let folderUrn: string | undefined;
    let entityId: string | undefined;
    
    if (input.includes('acc.autodesk.com')) {
      const folderMatch = input.match(/folderUrn=([^&]+)/);
      if (folderMatch) {
        folderUrn = decodeURIComponent(folderMatch[1]);
      }
      
      const entityMatch = input.match(/entityId=([^&]+)/);
      if (entityMatch) {
        entityId = decodeURIComponent(entityMatch[1]);
        setCurrentItemId(entityId);
      }
    }
    
    console.log('Loading files for project:', projectId, 'folder:', folderUrn, 'entity:', entityId);
    
    if (!viewer) {
      console.error('Viewer not initialized');
      toast.error("Viewer not initialized");
      return;
    }

    try {
      const token = await ensureValidToken();
      toast('Loading project files...');
      
      // Get project files
      const { data: filesData, error: filesError } = await supabase.functions.invoke('autodesk-files', {
        body: { 
          token,
          projectId: projectId,
          folderUrn,
          entityId
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

      console.log('Version URN:', tipVersionUrn);
      
      // Base64 encode the version URN for the viewer
      // Convert to base64 using btoa (browser's built-in function)
      const base64Urn = btoa(tipVersionUrn)
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, ''); // URL-safe base64
      
      const documentId = 'urn:' + base64Urn;
      
      console.log('Base64 encoded URN:', base64Urn);
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

  const toggleEditMode = () => {
    if (!viewer) return;
    
    const newEditMode = !editMode;
    setEditMode(newEditMode);
    
    if (newEditMode) {
      // Enable transform extension
      if (!transformExtensionRef.current) {
        createTransformExtension();
      }
      toast.success("Edit mode enabled - Select elements to move them");
    } else {
      // Disable transform extension
      if (transformExtensionRef.current) {
        viewer.unloadExtension('TransformExtension');
        transformExtensionRef.current = null;
      }
      toast("Edit mode disabled");
    }
  };

  const createTransformExtension = () => {
    if (!viewer || !window.Autodesk) return;

    // Define custom Transform Extension
    class TransformExtension extends window.Autodesk.Viewing.Extension {
      constructor(viewer: any, options: any) {
        super(viewer, options);
        this.selectedDbId = null;
        this.gizmoArrows = null;
        this.originalPosition = null;
        this.accumulatedOffset = new window.THREE.Vector3(0, 0, 0);
        this.raycaster = new window.THREE.Raycaster();
        this.keyboardHandler = null;
      }

      load() {
        console.log('TransformExtension loaded');
        
        // Listen for selection events
        this.viewer.addEventListener(
          window.Autodesk.Viewing.SELECTION_CHANGED_EVENT,
          this.onSelectionChanged.bind(this)
        );
        
        // Add keyboard controls
        this.keyboardHandler = this.onKeyDown.bind(this);
        document.addEventListener('keydown', this.keyboardHandler);
        
        return true;
      }

      unload() {
        this.viewer.removeEventListener(
          window.Autodesk.Viewing.SELECTION_CHANGED_EVENT,
          this.onSelectionChanged.bind(this)
        );
        
        if (this.keyboardHandler) {
          document.removeEventListener('keydown', this.keyboardHandler);
        }
        
        if (this.gizmoArrows) {
          this.removeGizmo();
        }
        
        return true;
      }

      onSelectionChanged(event: any) {
        const selection = event.dbIdArray;
        
        if (selection && selection.length === 1) {
          this.selectedDbId = selection[0];
          this.accumulatedOffset.set(0, 0, 0);
          this.showGizmo(selection[0]);
        } else {
          this.removeGizmo();
          this.selectedDbId = null;
        }
      }

      onKeyDown(event: KeyboardEvent) {
        if (!this.selectedDbId) return;
        
        const step = event.shiftKey ? 1.0 : 0.1;
        let offset = new window.THREE.Vector3(0, 0, 0);
        let handled = false;
        
        switch(event.key) {
          case 'ArrowLeft':
            offset.x = -step;
            handled = true;
            break;
          case 'ArrowRight':
            offset.x = step;
            handled = true;
            break;
          case 'ArrowUp':
            offset.y = step;
            handled = true;
            break;
          case 'ArrowDown':
            offset.y = -step;
            handled = true;
            break;
          case 'PageUp':
            offset.z = step;
            handled = true;
            break;
          case 'PageDown':
            offset.z = -step;
            handled = true;
            break;
        }
        
        if (handled) {
          event.preventDefault();
          this.accumulatedOffset.add(offset);
          this.moveFragment(this.selectedDbId, this.accumulatedOffset);
          this.updateGizmoPosition();
        }
      }

      showGizmo(dbId: number) {
        const viewer = this.viewer;
        const model = viewer.model;
        
        // Get the bounding box of the selected element
        const tree = model.getInstanceTree();
        const fragList = model.getFragmentList();
        
        tree.enumNodeFragments(dbId, (fragId: number) => {
          const bounds = new window.THREE.Box3();
          fragList.getWorldBounds(fragId, bounds);
          
          const center = bounds.getCenter(new window.THREE.Vector3());
          
          // Store original position
          this.originalPosition = { x: center.x, y: center.y, z: center.z };
          
          // Create arrow gizmos for X, Y, Z axes
          if (!this.gizmoArrows) {
            const arrowLength = 2;
            const arrowHeadLength = 0.4;
            const arrowHeadWidth = 0.3;
            
            // X axis (red)
            const xArrow = new window.THREE.ArrowHelper(
              new window.THREE.Vector3(1, 0, 0),
              center,
              arrowLength,
              0xff0000,
              arrowHeadLength,
              arrowHeadWidth
            );
            xArrow.userData.axis = 'x';
            
            // Y axis (green)
            const yArrow = new window.THREE.ArrowHelper(
              new window.THREE.Vector3(0, 1, 0),
              center,
              arrowLength,
              0x00ff00,
              arrowHeadLength,
              arrowHeadWidth
            );
            yArrow.userData.axis = 'y';
            
            // Z axis (blue)
            const zArrow = new window.THREE.ArrowHelper(
              new window.THREE.Vector3(0, 0, 1),
              center,
              arrowLength,
              0x0000ff,
              arrowHeadLength,
              arrowHeadWidth
            );
            zArrow.userData.axis = 'z';
            
            this.gizmoArrows = { x: xArrow, y: yArrow, z: zArrow };
            
            viewer.impl.addOverlay('transform-gizmo', xArrow);
            viewer.impl.addOverlay('transform-gizmo', yArrow);
            viewer.impl.addOverlay('transform-gizmo', zArrow);
          }
          
          viewer.impl.invalidate(true);
          
          // Add drag controls
          this.enableDragging(dbId, center);
        }, true);
      }

      updateGizmoPosition() {
        if (!this.gizmoArrows || !this.originalPosition) return;
        
        const newPos = new window.THREE.Vector3(
          this.originalPosition.x + this.accumulatedOffset.x,
          this.originalPosition.y + this.accumulatedOffset.y,
          this.originalPosition.z + this.accumulatedOffset.z
        );
        
        this.gizmoArrows.x.position.copy(newPos);
        this.gizmoArrows.y.position.copy(newPos);
        this.gizmoArrows.z.position.copy(newPos);
        
        this.viewer.impl.invalidate(true);
      }

      enableDragging(dbId: number, initialPos: any) {
        const viewer = this.viewer;
        let isDragging = false;
        let dragAxis: string | null = null;
        let startScreenPoint = { x: 0, y: 0 };
        
        const onMouseDown = (event: MouseEvent) => {
          if (event.button !== 0) return;
          
          // Test if we clicked on any of the arrow handles
          const camera = viewer.navigation.getCamera();
          const mouse = new window.THREE.Vector2(
            (event.clientX / viewer.canvas.clientWidth) * 2 - 1,
            -(event.clientY / viewer.canvas.clientHeight) * 2 + 1
          );
          
          this.raycaster.setFromCamera(mouse, camera);
          
          // Check intersection with arrow handles
          const intersects: any[] = [];
          if (this.gizmoArrows) {
            Object.values(this.gizmoArrows).forEach((arrow: any) => {
              const hits = this.raycaster.intersectObject(arrow, true);
              hits.forEach(hit => {
                hit.object.userData.axis = arrow.userData.axis;
                intersects.push(hit);
              });
            });
          }
          
          if (intersects.length > 0) {
            isDragging = true;
            dragAxis = intersects[0].object.userData.axis;
            startScreenPoint = { x: event.clientX, y: event.clientY };
            viewer.impl.controls.setIsLocked(true);
            event.stopPropagation();
          }
        };

        const onMouseMove = (event: MouseEvent) => {
          if (!isDragging || !dragAxis) return;
          
          // Calculate screen movement
          const deltaX = event.clientX - startScreenPoint.x;
          const deltaY = event.clientY - startScreenPoint.y;
          
          // Convert screen delta to world delta along the selected axis
          const sensitivity = 0.01;
          let offset = new window.THREE.Vector3(0, 0, 0);
          
          switch(dragAxis) {
            case 'x':
              offset.x = deltaX * sensitivity;
              break;
            case 'y':
              offset.y = -deltaY * sensitivity;
              break;
            case 'z':
              offset.z = -deltaY * sensitivity;
              break;
          }
          
          // Update accumulated offset
          this.accumulatedOffset.copy(offset);
          
          // Move fragment and update gizmo
          this.moveFragment(dbId, this.accumulatedOffset);
          this.updateGizmoPosition();
          
          event.stopPropagation();
        };

        const onMouseUp = (event: MouseEvent) => {
          if (!isDragging) return;
          
          isDragging = false;
          dragAxis = null;
          viewer.impl.controls.setIsLocked(false);
          
          // Record the change
          if (this.originalPosition && this.accumulatedOffset.length() > 0) {
            const newPos = {
              x: this.originalPosition.x + this.accumulatedOffset.x,
              y: this.originalPosition.y + this.accumulatedOffset.y,
              z: this.originalPosition.z + this.accumulatedOffset.z
            };
            
            // Get element name
            viewer.model.getProperties(dbId, (result: any) => {
              const elementName = result.name || `Element ${dbId}`;
              
              // Add to pending changes
              setPendingChanges((prev: any) => {
                const existing = prev.findIndex((c: any) => c.dbId === dbId);
                const change = {
                  dbId,
                  originalPosition: this.originalPosition,
                  newPosition: newPos,
                  elementName
                };
                
                if (existing >= 0) {
                  const updated = [...prev];
                  updated[existing] = change;
                  return updated;
                } else {
                  return [...prev, change];
                }
              });
              
              toast.success(`Moved ${elementName}`);
            });
          }
          
          event.stopPropagation();
        };

        viewer.canvas.addEventListener('mousedown', onMouseDown);
        viewer.canvas.addEventListener('mousemove', onMouseMove);
        viewer.canvas.addEventListener('mouseup', onMouseUp);
        
        // Store cleanup
        this.dragCleanup = () => {
          viewer.canvas.removeEventListener('mousedown', onMouseDown);
          viewer.canvas.removeEventListener('mousemove', onMouseMove);
          viewer.canvas.removeEventListener('mouseup', onMouseUp);
        };
      }

      moveFragment(dbId: number, totalOffset: any) {
        const viewer = this.viewer;
        const model = viewer.model;
        const tree = model.getInstanceTree();
        
        tree.enumNodeFragments(dbId, (fragId: number) => {
          const fragProxy = viewer.impl.getFragmentProxy(model, fragId);
          fragProxy.getAnimTransform();
          
          // Add to current position instead of replacing
          fragProxy.position.set(totalOffset.x, totalOffset.y, totalOffset.z);
          fragProxy.updateAnimTransform();
        }, true);
        
        viewer.impl.invalidate(true, true, true);
      }

      removeGizmo() {
        if (this.gizmoArrows) {
          this.viewer.impl.removeOverlay('transform-gizmo', this.gizmoArrows.x);
          this.viewer.impl.removeOverlay('transform-gizmo', this.gizmoArrows.y);
          this.viewer.impl.removeOverlay('transform-gizmo', this.gizmoArrows.z);
          this.gizmoArrows = null;
        }
        
        if (this.dragCleanup) {
          this.dragCleanup();
        }
        
        this.originalPosition = null;
        this.accumulatedOffset.set(0, 0, 0);
      }
    }

    // Register extension
    window.Autodesk.Viewing.theExtensionManager.registerExtension(
      'TransformExtension',
      TransformExtension
    );

    // Load extension
    viewer.loadExtension('TransformExtension').then((ext: any) => {
      transformExtensionRef.current = ext;
      console.log('Transform extension loaded');
    });
  };

  const handleSaveChanges = () => {
    if (pendingChanges.length === 0) {
      toast.error("No changes to save");
      return;
    }
    setShowSaveDialog(true);
  };

  const confirmSave = async () => {
    setIsSaving(true);
    setShowSaveDialog(false);
    
    try {
      if (!currentProjectId || !currentItemId) {
        throw new Error('No model loaded - project or item ID missing');
      }

      toast('Initiating save to Revit file...');

      // Call Design Automation edge function
      const { data, error } = await supabase.functions.invoke('revit-modify', {
        body: {
          token: accessToken,
          projectId: currentProjectId,
          itemId: currentItemId,
          transforms: pendingChanges.map(change => ({
            dbId: change.dbId,
            elementName: change.elementName,
            originalPosition: change.originalPosition,
            newPosition: change.newPosition
          }))
        }
      });

      if (error) {
        throw error;
      }

      console.log('Design Automation response:', data);

      toast.success(`Changes saved! ${pendingChanges.length} elements modified`);
      
      // Clear pending changes
      setPendingChanges([]);
      
      // Note: In production, you would reload the model here with the new version
      // await loadModel(manualProjectId);
      
    } catch (error) {
      console.error('Save error:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to save changes');
    } finally {
      setIsSaving(false);
    }
  };

  const clearChanges = () => {
    setPendingChanges([]);
    toast("Changes cleared");
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
              variant={editMode ? "default" : "ghost"}
              size="icon"
              onClick={toggleEditMode}
              className="hover:bg-secondary"
              title={editMode ? "Exit Edit Mode" : "Enter Edit Mode"}
            >
              <Edit3 className="h-5 w-5" />
            </Button>
            {pendingChanges.length > 0 && (
              <Button
                variant="default"
                size="sm"
                onClick={handleSaveChanges}
                disabled={isSaving}
                className="gap-1"
              >
                {isSaving ? (
                  <>
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Save className="h-4 w-4" />
                    Save ({pendingChanges.length})
                  </>
                )}
              </Button>
            )}
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
          
          {/* Edit Mode Instructions */}
          {editMode && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-card/95 border border-border rounded-lg px-4 py-2 shadow-lg">
              <p className="text-sm text-foreground font-medium">
                Click element → Drag colored arrows (X/Y/Z) or use keyboard: 
                <span className="ml-2 text-muted-foreground">Arrows=XY • PgUp/PgDn=Z • Shift=Faster</span>
              </p>
            </div>
          )}
        </div>

        {/* Pending Changes Panel */}
        {pendingChanges.length > 0 && (
          <div className="absolute bottom-4 left-4 bg-card border border-border rounded-lg p-4 max-w-sm shadow-lg">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-semibold text-foreground">Pending Changes ({pendingChanges.length})</h3>
              <Button
                variant="ghost"
                size="icon"
                onClick={clearChanges}
                className="h-6 w-6"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {pendingChanges.map((change, idx) => (
                <div key={idx} className="text-sm text-muted-foreground border-b border-border pb-2">
                  <div className="font-medium text-foreground">{change.elementName}</div>
                  <div className="text-xs">
                    From: ({change.originalPosition.x.toFixed(2)}, {change.originalPosition.y.toFixed(2)}, {change.originalPosition.z.toFixed(2)})
                  </div>
                  <div className="text-xs">
                    To: ({change.newPosition.x.toFixed(2)}, {change.newPosition.y.toFixed(2)}, {change.newPosition.z.toFixed(2)})
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>

      {/* Save Confirmation Dialog */}
      <AlertDialog open={showSaveDialog} onOpenChange={setShowSaveDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Save Changes to Revit File?</AlertDialogTitle>
            <AlertDialogDescription>
              This will save {pendingChanges.length} element transformation{pendingChanges.length !== 1 ? 's' : ''} to the Revit file via Design Automation.
              This process may take several minutes to complete.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmSave}>Save Changes</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Auth Prompt Dialog */}
      {showAuthPrompt && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <Card className="max-w-md p-6">
            <h3 className="text-lg font-semibold mb-2">Authentication Required</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Your session has expired or you need to sign in to access ACC projects.
            </p>
            <Button onClick={() => startAuthFlow()} className="w-full">
              Sign In with Autodesk
            </Button>
          </Card>
        </div>
      )}
    </div>
  );
};

export default Viewer;
