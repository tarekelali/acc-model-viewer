# Design Automation Setup Scripts

This directory contains automation scripts to simplify the AppBundle registration process.

## Quick Start

### Step 1: Compile the Revit Plugin

1. Open Visual Studio 2019 or later
2. Create a new **Class Library (.NET Framework)** project
3. Target **.NET Framework 4.8**
4. Install NuGet packages:
   ```
   Install-Package Autodesk.Forge.DesignAutomation.Revit -Version 2024.0.0
   Install-Package Newtonsoft.Json
   ```
5. Add Revit API references from `C:\Program Files\Autodesk\Revit 2024\`:
   - RevitAPI.dll
   - RevitAPIUI.dll
6. Copy the code from `docs/RevitPlugin.cs` into your project
7. Build the project (Release mode)
8. **Create the AppBundle folder structure:**
   ```
   RevitTransformPlugin.bundle/              ← Required .bundle wrapper
   ├── PackageContents.xml                   ← Must be at .bundle root
   └── Contents/
       ├── RevitTransformPlugin.dll
       ├── RevitTransformPlugin.addin        ← Required .addin manifest
       ├── Newtonsoft.Json.dll
       └── DesignAutomationBridge.dll
   ```
   
   **Commands to create the structure:**
   ```bash
   # From your project root
   mkdir -p RevitTransformPlugin.bundle/Contents
   
   # Copy DLLs to Contents folder
   cp RevitPlugin/bin/Release/RevitTransformPlugin.dll RevitTransformPlugin.bundle/Contents/
   cp RevitPlugin/bin/Release/Newtonsoft.Json.dll RevitTransformPlugin.bundle/Contents/
   cp RevitPlugin/bin/Release/DesignAutomationBridge.dll RevitTransformPlugin.bundle/Contents/
   
   # Copy PackageContents.xml to .bundle root (NOT Contents)
   cp PackageContents.xml RevitTransformPlugin.bundle/
   
   # Create the .addin manifest file inside Contents/
   cat > RevitTransformPlugin.bundle/Contents/RevitTransformPlugin.addin << 'EOF'
   <?xml version="1.0" encoding="utf-8"?>
   <RevitAddIns>
     <AddIn Type="DBApplication">
       <Name>RevitTransformApp</Name>
       <Assembly>RevitTransformPlugin.dll</Assembly>
       <AddInId>A1B2C3D4-E5F6-7890-ABCD-EF1234567890</AddInId>
       <FullClassName>RevitTransformPlugin.TransformApp</FullClassName>
       <VendorId>REVITTRANSFORM</VendorId>
       <VendorDescription>Revit Transform Plugin</VendorDescription>
     </AddIn>
   </RevitAddIns>
   EOF
   ```

9. **Create the ZIP file:**
   ```bash
   zip -r RevitTransformPlugin.zip RevitTransformPlugin.bundle
   ```
   
   **CRITICAL:** The ZIP must contain the `RevitTransformPlugin.bundle/` folder at the top level, not just its contents.

10. Place `RevitTransformPlugin.zip` in the root of this project

**PackageContents.xml** (at `.bundle` root):
```xml
<?xml version="1.0" encoding="utf-8"?>
<ApplicationPackage SchemaVersion="1.0" 
                     AutodeskProduct="Revit" 
                     ProductType="Application" 
                     Name="RevitTransformApp" 
                     AppVersion="1.0.0" 
                     Description="Transforms element positions in Revit"
                     Author="Your Name"
                     FriendlyVersion="1.0.0">
  <CompanyDetails Name="Your Company" />
  <Components Description="Revit Transform Application">
    <RuntimeRequirements OS="Win64" Platform="Revit" SeriesMin="R2025" SeriesMax="R2025" />
    <ComponentEntry AppName="RevitTransformApp" 
                    ModuleName="./Contents/RevitTransformPlugin.addin" 
                    AppDescription="Transforms element positions" 
                    LoadOnRevitStartup="True">
    </ComponentEntry>
  </Components>
</ApplicationPackage>
```

**RevitTransformPlugin.addin** (inside `Contents/` folder - created automatically by script above):
```xml
<?xml version="1.0" encoding="utf-8"?>
<RevitAddIns>
  <AddIn Type="DBApplication">
    <Name>RevitTransformApp</Name>
    <Assembly>RevitTransformPlugin.dll</Assembly>
    <AddInId>A1B2C3D4-E5F6-7890-ABCD-EF1234567890</AddInId>
    <FullClassName>RevitTransformPlugin.TransformApp</FullClassName>
    <VendorId>REVITTRANSFORM</VendorId>
    <VendorDescription>Revit Transform Plugin</VendorDescription>
  </AddIn>
</RevitAddIns>
```

### Step 2: Set Your Client Secret

The script needs your Autodesk Client Secret. Set it as an environment variable:

**Windows (PowerShell):**
```powershell
$env:AUTODESK_CLIENT_SECRET="your_secret_here"
```

**Mac/Linux:**
```bash
export AUTODESK_CLIENT_SECRET="your_secret_here"
```

### Step 3: Run the Setup Script

```bash
node scripts/setup-appbundle.js
```

The script will:
1. ✅ Authenticate with Autodesk
2. ✅ Create the AppBundle
3. ✅ Upload your plugin ZIP
4. ✅ Create the Activity
5. ✅ Set up aliases

## What This Does

The automation script handles all the API calls described in `docs/SETUP_GUIDE.md`:

- **AppBundle Registration**: Creates and uploads your compiled Revit plugin
- **Activity Creation**: Defines how Design Automation should run your plugin
- **Alias Management**: Sets up version aliases for easy updates

## Environment Variables

- `AUTODESK_CLIENT_ID`: Your app's client ID (defaults to the one in your project)
- `AUTODESK_CLIENT_SECRET`: Your app's client secret (required)

## Troubleshooting

### "RevitTransformPlugin.zip not found"
Make sure you've compiled the plugin and placed the ZIP file in the project root.

### "AUTODESK_CLIENT_SECRET environment variable is required"
Set your client secret as shown in Step 2 above.

### "HTTP 409: Conflict"
The AppBundle or Activity already exists. The script will continue and use the existing one.

### "WorkItem failed with status: failed"
Check the error logs. Common issues:
- Plugin DLL not compatible with Revit 2024
- Missing dependencies in the ZIP file
- Incorrect `PackageContents.xml` configuration

## Manual Setup

If you prefer to set up manually or need more control, follow the detailed guide in `docs/SETUP_GUIDE.md`.

## Need Help?

- Autodesk Forge forums: https://forge.autodesk.com/
- Design Automation API docs: https://aps.autodesk.com/en/docs/design-automation/v3/
