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
8. Create a ZIP file named `RevitTransformPlugin.zip` containing:
   - Your compiled DLL
   - `Newtonsoft.Json.dll`
   - `PackageContents.xml` (see below)
9. Place the ZIP file in the root of this project

**PackageContents.xml:**
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
    <RuntimeRequirements OS="Win64" Platform="Revit" SeriesMin="R2024" SeriesMax="R2024" />
    <ComponentEntry AppName="RevitTransformApp" 
                    ModuleName="./Contents/YourCompiledDll.dll" 
                    AppDescription="Transforms element positions" 
                    LoadOnRevitStartup="False" 
                    LoadOnCommandInvocation="True">
      <Commands GroupName="Autodesk">
        <Command Global="TransformApp" Local="TransformApp" />
      </Commands>
    </ComponentEntry>
  </Components>
</ApplicationPackage>
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
