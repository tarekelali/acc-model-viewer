import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { FolderTree, ZoomIn, ZoomOut, RotateCcw, Layers, LogIn, Edit3, Save, X, Upload } from "lucide-react";
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
  // SECURITY: Whitelist - only allow this project
  const ALLOWED_PROJECT_ID = "d27a6383-5881-4756-9cff-3deccd318427";
  
  // Hardcoded trial model URL
  const TRIAL_MODEL_URL = "https://acc.autodesk.com/docs/files/projects/d27a6383-5881-4756-9cff-3deccd318427?folderUrn=urn%3Aadsk.wipprod%3Afs.folder%3Aco.pTXcoJRjSkuopE4nj1Y-yA&entityId=urn%3Aadsk.wipprod%3Adm.lineage%3AzgRrW8akRpaXjYyDJoY-Zg&viewModel=detail&moduleId=folders&viewableGuid=b978b785-e198-7881-d90e-cf5603eb507f";
  
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
    uniqueId: string;  // Revit UniqueId (GUID)
    originalPosition: { x: number; y: number; z: number };
    newPosition: { x: number; y: number; z: number };
    elementName: string;
  }>>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);
  const [currentItemId, setCurrentItemId] = useState<string | null>(null);
  const [currentFolderUrn, setCurrentFolderUrn] = useState<string | null>(null);
  const [currentVersionUrn, setCurrentVersionUrn] = useState<string | null>(null);
  const [currentFileName, setCurrentFileName] = useState<string | null>(null);
  const [showAuthPrompt, setShowAuthPrompt] = useState(false);
  const [isReuploading, setIsReuploading] = useState(false);
  const [ossCoordinates, setOssCoordinates] = useState<{ bucket: string; object: string } | null>(null);
  
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
      
      // SECURITY: Frontend should only show whitelisted project
      const whitelistedProjects = allProjects.filter((p: Project) => 
        p.id.replace('b.', '') === ALLOWED_PROJECT_ID
      );
      
      if (whitelistedProjects.length === 0) {
        toast.error('No authorized projects found');
        return;
      }
      
      setProjects(whitelistedProjects);
      toast.success('Project loaded');
      
      // Auto-load the whitelisted project
      console.log('Auto-loading authorized project');
      setTimeout(() => loadModel(TRIAL_MODEL_URL), 1000);
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
    
    // SECURITY: Validate project ID on frontend
    if (projectId !== ALLOWED_PROJECT_ID) {
      toast.error(`Access denied: Only project ${ALLOWED_PROJECT_ID} is authorized`);
      console.error('Security: Attempted to load unauthorized project:', projectId);
      return;
    }
    
    setCurrentProjectId(projectId);
    
    // Extract folderUrn and entityId from ACC URL if present
    let folderUrn: string | undefined;
    let entityId: string | undefined;
    
    if (input.includes('acc.autodesk.com')) {
      const folderMatch = input.match(/folderUrn=([^&]+)/);
      if (folderMatch) {
        folderUrn = decodeURIComponent(folderMatch[1]);
        setCurrentFolderUrn(folderUrn);
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
      setCurrentItemId(viewableItem.id);
      setCurrentVersionUrn(tipVersionUrn);
      setCurrentFileName(viewableItem.attributes.displayName);
      setOssCoordinates(null); // Reset OSS coordinates for new model
      
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
            
            // Get element properties including UniqueId
            viewer.model.getProperties(dbId, (result: any) => {
              const elementName = result.name || `Element ${dbId}`;
              
              // Extract UniqueId (Revit GUID) from properties
              let uniqueId = null;
              if (result.externalId) {
                uniqueId = result.externalId;
              } else if (result.properties) {
                const uniqueIdProp = result.properties.find(
                  (p: any) => p.attributeName === 'UniqueId' || p.displayName === 'UniqueId'
                );
                if (uniqueIdProp) {
                  uniqueId = uniqueIdProp.displayValue;
                }
              }
              
              if (!uniqueId) {
                console.warn(`No UniqueId found for element ${dbId}, using dbId as fallback`);
              }
              
              // Add to pending changes with UniqueId
              setPendingChanges((prev: any) => {
                const existing = prev.findIndex((c: any) => c.dbId === dbId);
                const change = {
                  dbId,
                  uniqueId: uniqueId || `fallback-${dbId}`,
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
      // Validate required URNs
      if (!currentVersionUrn) {
        throw new Error('No Revit file version loaded');
      }
      if (!currentProjectId) {
        throw new Error('No project ID available');
      }
      if (!currentFolderUrn) {
        throw new Error('No folder URN available');
      }

      // Check if SSA re-upload has been done
      if (!ossCoordinates) {
        toast.error('Please click "SSA Re-upload" button first to upload the file to OSS storage. This is required to avoid memory limits.');
        return;
      }

      // Transform pendingChanges array into object format with full position data
      const transformsObject: Record<string, { 
        dbId: number;
        elementName: string;
        originalPosition: { x: number; y: number; z: number };
        newPosition: { x: number; y: number; z: number };
      }> = {};
      const validationErrors: string[] = [];

      console.log('=== Transform Creation Debug ===');
      console.log(`Processing ${pendingChanges.length} pending changes`);
      toast(`Preparing ${pendingChanges.length} transform(s) for save...`);

      pendingChanges.forEach((change, index) => {
        console.log(`\n--- Change ${index + 1}/${pendingChanges.length} ---`);
        console.log('Element:', change.elementName, `[${change.dbId}]`);
        console.log('dbId:', change.dbId);
        console.log('uniqueId:', change.uniqueId);
        console.log('Has originalPosition:', !!change.originalPosition);
        console.log('Has newPosition:', !!change.newPosition);
        if (change.originalPosition) {
          console.log('Original position:', change.originalPosition);
        }
        if (change.newPosition) {
          console.log('New position:', change.newPosition);
        }

        // Validate uniqueId
        if (!change.uniqueId || change.uniqueId.trim() === '') {
          const error = `Element ${change.elementName} (dbId: ${change.dbId}): Missing or empty uniqueId`;
          validationErrors.push(error);
          console.error('❌ VALIDATION ERROR:', error);
          return;
        }

        // Validate dbId
        if (!Number.isInteger(change.dbId) || change.dbId <= 0) {
          const error = `Element ${change.elementName}: Invalid dbId (${change.dbId})`;
          validationErrors.push(error);
          console.error('❌ VALIDATION ERROR:', error);
          return;
        }

        // Validate originalPosition exists
        if (!change.originalPosition || typeof change.originalPosition !== 'object') {
          const error = `Element ${change.elementName} (dbId: ${change.dbId}): Missing or invalid originalPosition`;
          validationErrors.push(error);
          console.error('❌ VALIDATION ERROR:', error);
          console.error('Change data:', change);
          return;
        }

        // Validate newPosition exists
        if (!change.newPosition || typeof change.newPosition !== 'object') {
          const error = `Element ${change.elementName} (dbId: ${change.dbId}): Missing or invalid newPosition`;
          validationErrors.push(error);
          console.error('❌ VALIDATION ERROR:', error);
          console.error('Change data:', change);
          return;
        }

        // Validate position properties exist
        if (!Number.isFinite(change.originalPosition.x) || 
            !Number.isFinite(change.originalPosition.y) || 
            !Number.isFinite(change.originalPosition.z)) {
          const error = `Element ${change.elementName}: Invalid originalPosition coordinates`;
          validationErrors.push(error);
          console.error('❌ VALIDATION ERROR:', error);
          console.error('originalPosition:', change.originalPosition);
          return;
        }

        if (!Number.isFinite(change.newPosition.x) || 
            !Number.isFinite(change.newPosition.y) || 
            !Number.isFinite(change.newPosition.z)) {
          const error = `Element ${change.elementName}: Invalid newPosition coordinates`;
          validationErrors.push(error);
          console.error('❌ VALIDATION ERROR:', error);
          console.error('newPosition:', change.newPosition);
          return;
        }

        // Calculate translation delta (difference between new and original positions)
        const deltaX = change.newPosition.x - change.originalPosition.x;
        const deltaY = change.newPosition.y - change.originalPosition.y;
        const deltaZ = change.newPosition.z - change.originalPosition.z;

        console.log('Original position:', change.originalPosition);
        console.log('New position:', change.newPosition);
        console.log('Delta:', { x: deltaX, y: deltaY, z: deltaZ });

        // Validate translation values
        if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY) || !Number.isFinite(deltaZ)) {
          const error = `Element ${change.elementName}: Invalid translation values (NaN or Infinity)`;
          validationErrors.push(error);
          console.error('❌ VALIDATION ERROR:', error);
          return;
        }

        // Use uniqueId as-is since it already contains the Revit element ID in hex format
        // The Revit UniqueId format is: [GUID]-[ElementId in hex]
        // Example: "8F0B7F3F-D7D8-4B8E-9F3E-1A2B3C4D5E6F-0001f43b"
        const compositeKey = change.uniqueId;

        console.log('dbId (decimal):', change.dbId);
        console.log('uniqueId (contains element ID):', change.uniqueId);
        console.log('Composite key:', compositeKey);

        // Validate composite key format (should contain at least one dash for Revit UniqueId)
        if (!compositeKey || !compositeKey.includes('-')) {
          const error = `Element ${change.elementName}: Invalid uniqueId format (${compositeKey})`;
          validationErrors.push(error);
          console.error('❌ VALIDATION ERROR:', error);
          return;
        }

        transformsObject[compositeKey] = {
          dbId: change.dbId,
          elementName: change.elementName,
          originalPosition: {
            x: change.originalPosition.x,
            y: change.originalPosition.y,
            z: change.originalPosition.z
          },
          newPosition: {
            x: change.newPosition.x,
            y: change.newPosition.y,
            z: change.newPosition.z
          }
        };

        console.log('✓ Transform added successfully');
      });

      console.log('\n=== Transform Validation Summary ===');
      console.log(`Total changes: ${pendingChanges.length}`);
      console.log(`Valid transforms: ${Object.keys(transformsObject).length}`);
      console.log(`Validation errors: ${validationErrors.length}`);

      if (validationErrors.length > 0) {
        console.error('\n❌ Validation Errors:');
        validationErrors.forEach(err => console.error(`  - ${err}`));
        toast.error(`Validation failed: ${validationErrors.length} error(s). Check console.`);
        throw new Error(`Transform validation failed with ${validationErrors.length} error(s). Check console for details.`);
      }

      console.log('✓ All transforms validated successfully');
      console.log('\nFinal transforms object:');
      console.log(JSON.stringify(transformsObject, null, 2));
      toast.success(`✓ Validated ${Object.keys(transformsObject).length} transform(s)`);

      const supabaseAnonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      const baseUrl = 'https://mbkfbmsjwlgqyzhfjwka.supabase.co/functions/v1';
      
      if (!supabaseAnonKey || !accessToken) {
        throw new Error('Missing authentication credentials');
      }

      const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${supabaseAnonKey}`,
        'apikey': supabaseAnonKey,
      };

      // STEP 1: Start the job
      toast(`Starting Design Automation job with ${Object.keys(transformsObject).length} transform(s)...`);
      
      const requestPayload = {
        token: accessToken,
        itemId: currentItemId,
        projectId: currentProjectId,
        folderUrn: currentFolderUrn,
        transforms: transformsObject,
        ossBucket: ossCoordinates.bucket,
        ossObject: ossCoordinates.object
      };

      // Log the full request payload for debugging
      console.log('\n=== Design Automation Request Debug ===');
      console.log('Request payload summary:');
      console.log({
        hasToken: !!accessToken,
        tokenLength: accessToken?.length,
        itemId: requestPayload.itemId,
        projectId: requestPayload.projectId,
        folderUrn: requestPayload.folderUrn,
        transformCount: Object.keys(transformsObject).length,
        hasOssCoordinates: !!(requestPayload.ossBucket && requestPayload.ossObject),
        ossBucket: requestPayload.ossBucket,
        ossObject: requestPayload.ossObject
      });

      console.log('\n=== Transform Keys Being Sent ===');
      Object.keys(transformsObject).forEach((key, index) => {
        const parts = key.split('-');
        const guidPart = parts.slice(0, -1).join('-');
        const revitIdHex = parts[parts.length - 1];
        const revitIdDecimal = parseInt(revitIdHex, 16);
        console.log(`${index + 1}. Key: "${key}"`);
        console.log(`   - GUID part: "${guidPart}"`);
        console.log(`   - Revit Element ID (hex): ${revitIdHex}`);
        console.log(`   - Revit Element ID (decimal): ${revitIdDecimal}`);
        console.log(`   - Original Position:`, transformsObject[key].originalPosition);
        console.log(`   - New Position:`, transformsObject[key].newPosition);
      });

      console.log('\n=== Full Request Payload ===');
      console.log(JSON.stringify(requestPayload, null, 2));
      
      const startResponse = await fetch(`${baseUrl}/revit-modify`, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestPayload),
      });

      console.log('\n=== Design Automation Start Response ===');
      console.log('Response status:', startResponse.status, startResponse.statusText);
      console.log('Response headers:', Object.fromEntries(startResponse.headers.entries()));

      const startResult = await startResponse.json();
      console.log('Response body:', startResult);

      if (!startResponse.ok || !startResult.workItemId) {
        console.error('\n❌ Design Automation Start Failed');
        console.error('Response status:', startResponse.status);
        console.error('Response body:', startResult);

        // Log any error details from the response
        if (startResult.error) {
          console.error('Error details:', startResult.error);
        }
        if (startResult.message) {
          console.error('Error message:', startResult.message);
        }
        if (startResult.stack) {
          console.error('Stack trace:', startResult.stack);
        }

        throw new Error(startResult.message || startResult.error || 'Failed to start Design Automation job');
      }

      const { workItemId, bucketKeyTemp, outputObjectKey } = startResult;
      console.log('✓ WorkItem created:', workItemId);
      console.log(`✓ Submitted ${Object.keys(transformsObject).length} transform(s) to Design Automation`);
      toast.success(`Processing ${Object.keys(transformsObject).length} transform(s)...`);

      // STEP 2: Poll for status
      let attempts = 0;
      const maxAttempts = 60; // 10 minutes max
      const pollInterval = 10000; // 10 seconds

      toast('Processing... (this may take 2-5 minutes)');

      while (attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, pollInterval));
        attempts++;

        const statusResponse = await fetch(`${baseUrl}/revit-status`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ workItemId }),
        });

        if (!statusResponse.ok) {
          console.warn(`⚠️ Status check failed (attempt ${attempts}):`, statusResponse.status, statusResponse.statusText);
          continue;
        }

        const statusData = await statusResponse.json();
        const status = statusData.status;

        console.log(`\n📊 Work item status (attempt ${attempts}):`, status);
        if (statusData.progress) {
          console.log('Progress:', statusData.progress);
        }

        toast(`Processing... (${attempts * 10}s elapsed, status: ${status})`);

        if (status === 'success') {
          console.log('\n✓ Design Automation processing completed successfully!');
          toast('Processing complete - uploading to ACC...');

          // STEP 3: Complete the upload to ACC
          console.log('\n=== Starting ACC Upload ===');
          console.log('Upload parameters:', {
            projectId: currentProjectId,
            itemId: currentItemId,
            bucketKeyTemp,
            outputObjectKey
          });

          const completeResponse = await fetch(`${baseUrl}/revit-complete`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              token: accessToken,
              projectId: currentProjectId,
              itemId: currentItemId,
              bucketKeyTemp,
              outputObjectKey
            }),
          });

          console.log('Upload response status:', completeResponse.status, completeResponse.statusText);

          const completeResult = await completeResponse.json();
          console.log('Upload response body:', completeResult);

          if (!completeResponse.ok) {
            console.error('\n❌ ACC Upload Failed');
            console.error('Response status:', completeResponse.status);
            console.error('Response body:', completeResult);
            throw new Error(completeResult.error || completeResult.message || 'Failed to upload to ACC');
          }

          console.log('\n✓ Upload complete successfully!');
          console.log(`✓ ${Object.keys(transformsObject).length} transform(s) applied to Revit file`);
          toast.success(`✓ Saved ${Object.keys(transformsObject).length} transform(s) to Revit file! New version: ${completeResult.versionId}`);
          
          // Clear pending changes
          setPendingChanges([]);
          return;
        }

        if (status.startsWith('failed')) {
          console.error('\n❌ Design Automation Job Failed');
          console.error('Status:', status);
          console.error('Full status result:', statusData);

          if (statusData.reportContent) {
            console.error('\n📄 Report Content (last 1000 chars):');
            console.error(statusData.reportContent.slice(-1000));
          }

          const errorMsg = statusData.reportContent
            ? `Design Automation failed: ${statusData.reportContent.slice(-500)}`
            : 'Design Automation job failed';
          throw new Error(errorMsg);
        }

        // Status is 'pending' or 'inprogress', continue polling
      }

      throw new Error('Job timed out after 10 minutes');

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

  const handleReuploadWithSSA = async () => {
    setIsReuploading(true);
    
    try {
      // Validate that all required data is available
      if (!currentProjectId || !currentFolderUrn || !currentItemId || !currentFileName) {
        toast.error("Please load a model first before re-uploading");
        setIsReuploading(false);
        return;
      }
      
      const token = await ensureValidToken();
      
      toast(`Re-uploading ${currentFileName} with SSA app...`);
      
      const { data, error } = await supabase.functions.invoke('reupload-file-ssa', {
        body: {
          userToken: token,
          projectId: currentProjectId,
          folderUrn: currentFolderUrn,
          itemUrn: currentItemId,
          fileName: currentFileName
        },
      });

      if (error) {
        console.error('Re-upload error:', error);
        const errorMessage = error.message || 'Unknown error';
        const isFileTooLarge = errorMessage.includes('too large') || errorMessage.includes('100MB');
        
        toast.error(
          isFileTooLarge 
            ? 'File is too large (>100MB) for edge function processing. Please use smaller files or contact support for alternative methods.'
            : `Re-upload failed: ${errorMessage}`
        );
        return;
      }

      console.log('Re-upload response:', data);
      
      // Store OSS coordinates for later use in revit-modify
      if (data.ossBucket && data.ossObject) {
        setOssCoordinates({
          bucket: data.ossBucket,
          object: data.ossObject
        });
        toast.success(`File re-uploaded successfully! OSS coordinates stored. You can now save transformations.`);
      } else {
        toast.success('File re-uploaded successfully! The SSA app now owns the file.');
      }
      
    } catch (error) {
      console.error('Re-upload error:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to re-upload file');
    } finally {
      setIsReuploading(false);
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

          {/* Re-upload with SSA button */}
          {accessToken && (
            <div className="space-y-2 pb-4 border-b border-border">
              <label className="text-sm font-medium text-foreground">SSA Re-upload</label>
              {ossCoordinates && (
                <div className="text-xs text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-950 p-2 rounded">
                  ✓ File uploaded to OSS storage
                </div>
              )}
              <Button
                onClick={handleReuploadWithSSA}
                disabled={isReuploading}
                size="sm"
                variant="secondary"
                className="w-full gap-2"
              >
                {isReuploading ? (
                  <>
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                    Re-uploading...
                  </>
                ) : (
                  <>
                    <Upload className="h-4 w-4" />
                    {ossCoordinates ? 'Re-upload Again' : 'Re-upload to OSS'}
                  </>
                )}
              </Button>
              <p className="text-xs text-muted-foreground">
                {ossCoordinates 
                  ? 'File ready for transformations. Re-upload if needed.'
                  : 'Required before saving transformations to avoid memory limits.'
                }
              </p>
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
              const isTarget = project.id.replace('b.', '') === ALLOWED_PROJECT_ID;
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
