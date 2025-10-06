# Design Automation API Integration Guide

## Overview

This project now includes the infrastructure for Design Automation API integration, which allows saving element transformations back to the source Revit files in Autodesk Construction Cloud (ACC).

## What's Been Implemented

### 1. Edge Function: `revit-modify`
- **Location**: `supabase/functions/revit-modify/index.ts`
- **Purpose**: Orchestrates the Design Automation workflow
- **Status**: ✅ Infrastructure complete, DA calls pending AppBundle setup
- **Features**:
  - Downloads source Revit file from ACC
  - Prepares transformation data
  - Ready to integrate with Design Automation WorkItems
  - Returns structured responses

### 2. Frontend Integration
- **File**: `src/pages/Viewer.tsx`
- **Status**: ✅ Complete
- **Features**:
  - Tracks current project and item IDs
  - Save button with loading state
  - Calls `revit-modify` edge function
  - Handles success/error responses
  - Clears pending changes after save

### 3. OAuth Scope Update
- **File**: `supabase/functions/autodesk-auth/index.ts`
- **Status**: ✅ Complete
- **Changes**: Added `code:all` scope for Design Automation access

### 4. Revit Plugin (C#)
- **Location**: `docs/RevitPlugin.cs`
- **Status**: ⚠️ Requires compilation and upload
- **Purpose**: Applies transformations to Revit elements in Design Automation environment

## Next Steps to Complete Integration

### Step 1: Compile the Revit Plugin

1. **Create Visual Studio Project**:
   ```
   - Project Type: Class Library (.NET Framework 4.8)
   - Name: RevitTransformPlugin
   ```

2. **Install NuGet Packages**:
   ```powershell
   Install-Package DesignAutomationBridge
   Install-Package Newtonsoft.Json
   ```

3. **Add Revit API References**:
   - Add references to `RevitAPI.dll` and `RevitAPIUI.dll`
   - Located in: `C:\Program Files\Autodesk\Revit 2024\`

4. **Copy Plugin Code**:
   - Copy code from `docs/RevitPlugin.cs` into your project
   - Build the project (Release configuration)

5. **Create AppBundle Package**:
   ```
   RevitTransformPlugin.bundle/
   ├── Contents/
   │   └── RevitTransformPlugin.dll
   │   └── Newtonsoft.Json.dll
   │   └── PackageContents.xml
   ```

   **PackageContents.xml**:
   ```xml
   <?xml version="1.0" encoding="utf-8"?>
   <ApplicationPackage>
     <Components>
       <RuntimeRequirements OS="Win64" Platform=".NET" SeriesMin="R2024" SeriesMax="R2024" />
       <ComponentEntry AppName="RevitTransformPlugin" 
                       ModuleName="./Contents/RevitTransformPlugin.dll" 
                       AppDescription="Element Transform Plugin" />
     </Components>
   </ApplicationPackage>
   ```

6. **Create ZIP file** of the entire `.bundle` folder

### Step 2: Register AppBundle with Design Automation

Use Postman or cURL to register the AppBundle:

```bash
POST https://developer.api.autodesk.com/da/us-east/v3/appbundles
Authorization: Bearer YOUR_TOKEN
Content-Type: application/json

{
  "id": "RevitTransformPlugin",
  "engine": "Autodesk.Revit+2024",
  "description": "Applies element transformations to Revit files"
}
```

Then upload the ZIP file:
```bash
POST https://developer.api.autodesk.com/da/us-east/v3/appbundles/RevitTransformPlugin/versions
Content-Type: application/json

{
  "description": "Initial version",
  "bundle": "RevitTransformPlugin.zip"
}
```

### Step 3: Create Activity

```bash
POST https://developer.api.autodesk.com/da/us-east/v3/activities
Authorization: Bearer YOUR_TOKEN
Content-Type: application/json

{
  "id": "TransformActivity",
  "commandLine": [
    "$(engine.path)\\\\revitcoreconsole.exe /i $(args[inputRvt].path) /al $(appbundles[RevitTransformPlugin].path)"
  ],
  "engine": "Autodesk.Revit+2024",
  "appbundles": ["RevitTransformPlugin+prod"],
  "parameters": {
    "inputRvt": {
      "verb": "get",
      "description": "Input Revit file",
      "required": true
    },
    "transforms": {
      "verb": "get",
      "localName": "transforms.json",
      "description": "Transformation data"
    },
    "outputRvt": {
      "verb": "put",
      "localName": "output.rvt",
      "description": "Modified Revit file"
    }
  }
}
```

### Step 4: Update Edge Function with WorkItem Logic

Once AppBundle and Activity are configured, update `supabase/functions/revit-modify/index.ts`:

Add after downloading the file (around line 96):

```typescript
// Step 5: Upload file to Design Automation
const uploadResponse = await fetch(
  'https://developer.api.autodesk.com/oss/v2/buckets/YOUR_BUCKET/objects/input.rvt',
  {
    method: 'PUT',
    headers: { 'Authorization': `Bearer ${token}` },
    body: fileBlob
  }
);

// Step 6: Create WorkItem
const workItemResponse = await fetch(
  'https://developer.api.autodesk.com/da/us-east/v3/workitems',
  {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      activityId: 'YourAlias.TransformActivity+prod',
      arguments: {
        inputRvt: {
          url: uploadUrl,
          verb: 'get'
        },
        transforms: {
          url: `data:application/json,${JSON.stringify({ transforms })}`,
          verb: 'get'
        },
        outputRvt: {
          url: outputSignedUrl,
          verb: 'put'
        }
      }
    })
  }
);

const workItem = await workItemResponse.json();

// Step 7: Poll for completion
let status = 'pending';
let attempts = 0;
const maxAttempts = 60; // 10 minutes (10s intervals)

while (status === 'pending' || status === 'inprogress') {
  if (attempts++ > maxAttempts) {
    throw new Error('WorkItem timeout after 10 minutes');
  }
  
  await new Promise(resolve => setTimeout(resolve, 10000)); // Wait 10s
  
  const statusResponse = await fetch(
    `https://developer.api.autodesk.com/da/us-east/v3/workitems/${workItem.id}`,
    { headers: { 'Authorization': `Bearer ${token}` } }
  );
  
  const statusData = await statusResponse.json();
  status = statusData.status;
  
  console.log(`WorkItem status: ${status}`);
}

if (status !== 'success') {
  throw new Error(`WorkItem failed with status: ${status}`);
}

// Step 8: Download modified file
const modifiedFileResponse = await fetch(outputSignedUrl);
const modifiedFile = await modifiedFileResponse.blob();

// Step 9: Upload back to ACC as new version
const newVersionResponse = await fetch(
  `https://developer.api.autodesk.com/data/v1/projects/b.${projectId}/items/${itemId}/versions`,
  {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/vnd.api+json'
    },
    body: JSON.stringify({
      jsonapi: { version: '1.0' },
      data: {
        type: 'versions',
        attributes: {
          name: 'Modified via Design Automation',
          extension: {
            type: 'versions:autodesk.bim360:File',
            version: '1.0'
          }
        },
        relationships: {
          item: {
            data: { type: 'items', id: itemId }
          },
          storage: {
            data: { type: 'objects', id: newStorageId }
          }
        }
      }
    })
  }
);
```

## Current Workflow

1. ✅ User moves elements in viewer
2. ✅ Changes tracked in `pendingChanges` state
3. ✅ User clicks "Save" button
4. ✅ Frontend calls `revit-modify` edge function
5. ✅ Edge function downloads source file from ACC
6. ⚠️ Edge function creates WorkItem (pending AppBundle)
7. ⚠️ Design Automation runs Revit plugin
8. ⚠️ Modified file uploaded back to ACC
9. ✅ Frontend shows success/error message

## Testing

### Test Without Design Automation
The current implementation will:
1. Successfully download the file from ACC
2. Log the transformations
3. Return a success message with note about pending setup

### Test With Design Automation (After Setup)
1. Move an element in the viewer
2. Click "Save"
3. Check edge function logs for WorkItem progress
4. Verify new version appears in ACC
5. Reload model and verify changes persist

## Troubleshooting

### Common Issues

1. **"Missing required parameters"**
   - Ensure model is loaded from ACC URL with projectId and itemId
   - Check browser console for tracked IDs

2. **"Failed to fetch item"**
   - Verify OAuth token has `data:read data:write code:all` scopes
   - Re-authenticate if token expired

3. **"AppBundle not found"**
   - Complete Step 2 to register AppBundle
   - Verify AppBundle ID matches Activity configuration

4. **WorkItem timeout**
   - Large files may take >10 minutes
   - Increase `maxAttempts` in polling loop
   - Check Design Automation logs for errors

5. **Elements not moving correctly**
   - DbId mapping may not match Element.Id
   - Consider using UniqueId instead
   - Check unit conversions (inches vs feet)

## API Reference

- [Design Automation API Docs](https://aps.autodesk.com/en/docs/design-automation/v3/)
- [Revit DA Tutorial](https://aps.autodesk.com/en/docs/design-automation/v3/tutorials/revit/)
- [Data Management API](https://aps.autodesk.com/en/docs/data/v2/)

## Security Notes

- Never commit AppBundle files to source control
- Use environment variables for sensitive IDs
- Implement proper error handling for production
- Consider rate limiting for WorkItem creation
- Add user permissions check before allowing saves

## Support

For issues with:
- **Frontend/Edge Function**: Check browser console and edge function logs
- **Design Automation**: Check DA logs via API
- **Revit Plugin**: Test locally with Revit first before uploading
