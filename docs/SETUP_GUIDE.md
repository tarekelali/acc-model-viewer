# Design Automation Setup Guide

## Overview

Your edge function now has the **complete Design Automation workflow** implemented! However, there's one critical prerequisite: you need to set up the Revit Plugin AppBundle with Autodesk's Design Automation API.

## ✅ What's Already Complete

- ✅ Full WorkItem workflow in `revit-modify` edge function
- ✅ File download/upload to/from ACC
- ✅ Transformation data serialization
- ✅ WorkItem polling and status checking
- ✅ New version creation in ACC
- ✅ Revit plugin C# code (in `docs/RevitPlugin.cs`)
- ✅ Error handling and logging

## ⚠️ What You Need to Do

You need to **compile and register the Revit Plugin** with Design Automation. This is a one-time setup.

---

## Setup Steps

### Prerequisites

- **Visual Studio 2019+** (Community Edition is free)
- **Revit 2024** installed (for the Revit API DLLs)
- **Autodesk Platform Services account** (free developer account)

### Step 1: Compile the Revit Plugin

1. **Create a new Visual Studio project:**
   - File → New → Project
   - Select "Class Library (.NET Framework 4.8)"
   - Name: `RevitTransformPlugin`

2. **Install NuGet packages:**
   ```powershell
   Install-Package Autodesk.Forge.DesignAutomation.Revit -Version 2024.0.0
   Install-Package Newtonsoft.Json
   ```

3. **Add Revit API references:**
   - Right-click project → Add Reference → Browse
   - Navigate to: `C:\Program Files\Autodesk\Revit 2024\`
   - Add: `RevitAPI.dll` and `RevitAPIUI.dll`
   - Set "Copy Local" to `False` for both

4. **Copy the plugin code:**
   - Replace the default `Class1.cs` with the code from `docs/RevitPlugin.cs`
   - Build the project (Release configuration)

5. **Create the AppBundle package:**
   
   Create this folder structure:
   ```
   RevitTransformPlugin.bundle/
   ├── Contents/
   │   ├── RevitTransformPlugin.dll
   │   ├── Newtonsoft.Json.dll
   │   └── PackageContents.xml
   ```

   **PackageContents.xml:**
   ```xml
   <?xml version="1.0" encoding="utf-8"?>
   <ApplicationPackage>
     <Components>
       <RuntimeRequirements OS="Win64" Platform=".NET" SeriesMin="R2024" SeriesMax="R2024" />
       <ComponentEntry 
         AppName="RevitTransformPlugin" 
         ModuleName="./Contents/RevitTransformPlugin.dll" 
         AppDescription="Element Transform Plugin" />
     </Components>
   </ApplicationPackage>
   ```

6. **Create a ZIP file** of the entire `.bundle` folder

### Step 2: Register with Design Automation API

You can use Postman, cURL, or any HTTP client. Replace `YOUR_TOKEN` with a valid Autodesk 3-legged OAuth token (the same one your app uses).

#### 2a. Create the AppBundle

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

**Response:** You'll get an AppBundle ID like `YourClientId.RevitTransformPlugin+1`

#### 2b. Upload the AppBundle ZIP

```bash
POST https://developer.api.autodesk.com/da/us-east/v3/appbundles/RevitTransformPlugin/versions
Authorization: Bearer YOUR_TOKEN
Content-Type: application/json

{
  "description": "Initial version"
}
```

**Response:** You'll get an upload URL. Use a second request to upload the ZIP:

```bash
PUT <upload-url-from-response>
Content-Type: application/octet-stream
Body: [Your RevitTransformPlugin.bundle.zip file]
```

#### 2c. Create an alias (makes it "prod")

```bash
POST https://developer.api.autodesk.com/da/us-east/v3/appbundles/RevitTransformPlugin/aliases
Authorization: Bearer YOUR_TOKEN
Content-Type: application/json

{
  "id": "prod",
  "version": 1
}
```

### Step 3: Create the Activity

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
  "appbundles": ["YourClientId.RevitTransformPlugin+prod"],
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

Replace `YourClientId` with your actual Autodesk client ID: `UonGGAilCryEuzl6kCD2owAcIiFZXobglVyZamHkTktJg2AY`

#### 3b. Create an alias for the activity

```bash
POST https://developer.api.autodesk.com/da/us-east/v3/activities/TransformActivity/aliases
Authorization: Bearer YOUR_TOKEN
Content-Type: application/json

{
  "id": "prod",
  "version": 1
}
```

### Step 4: Test It!

1. **Move an element** in the viewer
2. **Click Save**
3. **Check the edge function logs** for progress
4. **Wait 1-2 minutes** for Design Automation to process
5. **Refresh the viewer** - you should see the new version

---

## Environment Variables (Optional)

If your AppBundle/Activity have different names, set these in Supabase:

```bash
DA_APPBUNDLE_ALIAS=YourClientId.CustomAppBundleName+prod
DA_ACTIVITY_ALIAS=YourClientId.CustomActivityName+prod
```

By default, the edge function uses:
- AppBundle: `<clientId>.RevitTransformPlugin+prod`
- Activity: `<clientId>.TransformActivity+prod`

---

## Troubleshooting

### "Design Automation AppBundle not configured"

This means the Activity doesn't exist. Complete Steps 2-3 above.

### "WorkItem failed: failedInstructions"

- Check the Design Automation report URL in the error message
- Common causes:
  - Plugin crashed (check C# code for null references)
  - DbId mapping issue (Viewer ID ≠ Revit Element ID)
  - File access permissions

### "WorkItem timeout after 10 minutes"

- Large files may take longer
- Increase `maxAttempts` in the edge function
- Check DA report logs for actual failure

### Elements not moving correctly

The plugin maps Viewer dbId to Revit Element.Id, which may not always match. Solutions:

1. **Use UniqueId instead** (modify plugin to accept UniqueId)
2. **Add custom parameter mapping** (store Viewer ID in Revit parameter)
3. **Use element name matching** (less reliable but simpler)

---

## Cost & Limits

- **Free tier**: 100 cloud credits/month (approximately 100 WorkItems)
- **Paid tier**: $0.50 per cloud credit
- **WorkItem timeout**: 1 hour maximum
- **File size limit**: 4 GB

See: https://aps.autodesk.com/pricing

---

## API References

- [Design Automation API Docs](https://aps.autodesk.com/en/docs/design-automation/v3/)
- [Revit DA Tutorial](https://aps.autodesk.com/en/docs/design-automation/v3/tutorials/revit/)
- [AppBundle Packaging](https://aps.autodesk.com/en/docs/design-automation/v3/developers_guide/appbundles/)
- [Data Management API](https://aps.autodesk.com/en/docs/data/v2/)

---

## What Happens When You Click Save

1. **Frontend** sends transform data to `revit-modify` edge function
2. **Edge function** downloads the Revit file from ACC
3. **Edge function** uploads file to temporary OSS bucket
4. **Edge function** creates a Design Automation WorkItem
5. **Design Automation** spins up a Revit instance in the cloud
6. **Revit Plugin** reads transforms.json and moves elements
7. **Revit Plugin** saves the modified file
8. **Design Automation** uploads the result
9. **Edge function** downloads the modified file
10. **Edge function** creates a new version in ACC
11. **Frontend** shows success message

---

## Need Help?

- Check edge function logs in Supabase
- Check Design Automation logs (WorkItem report URL)
- Review `docs/RevitPlugin.cs` for plugin logic
- Test the plugin locally in Revit first (using journal files)

The architecture is complete - you just need to compile and register the plugin! 🚀
