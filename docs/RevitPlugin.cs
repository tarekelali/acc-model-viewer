// RevitTransformPlugin.cs
// This C# Revit plugin applies element transformations for Design Automation
// 
// SETUP INSTRUCTIONS:
// 1. Create a new Class Library project in Visual Studio (.NET Framework 4.8)
// 2. Install NuGet packages:
//    - DesignAutomationBridge
//    - Newtonsoft.Json
// 3. Add Revit API references (RevitAPI.dll, RevitAPIUI.dll)
// 4. Build the project
// 5. Create AppBundle ZIP containing the DLL and dependencies
// 6. Upload to Design Automation via Postman or API
//
// DESIGN AUTOMATION SETUP:
// See: https://aps.autodesk.com/en/docs/design-automation/v3/tutorials/revit/
//
// AppBundle creation:
// POST https://developer.api.autodesk.com/da/us-east/v3/appbundles
// {
//   "id": "RevitTransformPlugin",
//   "engine": "Autodesk.Revit+2024",
//   "description": "Applies element transformations"
// }
//
// Activity creation:
// POST https://developer.api.autodesk.com/da/us-east/v3/activities
// {
//   "id": "TransformActivity",
//   "commandLine": ["$(engine.path)\\\\revitcoreconsole.exe /i $(args[inputRvt].path) /al $(appbundles[RevitTransformPlugin].path)"],
//   "engine": "Autodesk.Revit+2024",
//   "appbundles": ["RevitTransformPlugin+prod"],
//   "parameters": {
//     "inputRvt": { "verb": "get" },
//     "transforms": { "verb": "get", "localName": "transforms.json" },
//     "outputRvt": { "verb": "put", "localName": "output.rvt" }
//   }
// }

using System;
using System.Collections.Generic;
using System.IO;
using Autodesk.Revit.ApplicationServices;
using Autodesk.Revit.DB;
using DesignAutomationFramework;
using Newtonsoft.Json;

namespace RevitTransformPlugin
{
    [Autodesk.Revit.Attributes.Regeneration(Autodesk.Revit.Attributes.RegenerationOption.Manual)]
    [Autodesk.Revit.Attributes.Transaction(Autodesk.Revit.Attributes.TransactionMode.Manual)]
    public class TransformApp : IExternalDBApplication
    {
        public ExternalDBApplicationResult OnStartup(ControlledApplication app)
        {
            DesignAutomationBridge.DesignAutomationReadyEvent += HandleDesignAutomation;
            return ExternalDBApplicationResult.Succeeded;
        }

        public ExternalDBApplicationResult OnShutdown(ControlledApplication app)
        {
            return ExternalDBApplicationResult.Succeeded;
        }

        public void HandleDesignAutomation(object sender, DesignAutomationReadyEventArgs e)
        {
            e.Succeeded = ProcessTransforms(e.DesignAutomationData);
        }

        private bool ProcessTransforms(DesignAutomationData data)
        {
            if (data == null)
            {
                Console.WriteLine("DesignAutomationData is null");
                return false;
            }

            Document doc = data.RevitDoc;
            if (doc == null)
            {
                Console.WriteLine("Document is null");
                return false;
            }

            try
            {
                // Read transformation data
                string transformsPath = Path.Combine(Directory.GetCurrentDirectory(), "transforms.json");
                if (!File.Exists(transformsPath))
                {
                    Console.WriteLine("transforms.json not found at: " + transformsPath);
                    return false;
                }

                string json = File.ReadAllText(transformsPath);
                var transformData = JsonConvert.DeserializeObject<TransformData>(json);

                Console.WriteLine($"Processing {transformData.Transforms.Count} transformations...");

                using (Transaction trans = new Transaction(doc, "Apply Element Transforms"))
                {
                    trans.Start();

                    int successCount = 0;
                    int failCount = 0;

                    foreach (var transform in transformData.Transforms)
                    {
                        try
                        {
                            // Try to get element by dbId (viewer ID)
                            // Note: dbId in Forge Viewer may not match Element.Id in Revit
                            // You may need to use UniqueId or custom parameter mapping
                            
                            ElementId elemId = new ElementId(transform.DbId);
                            Element element = doc.GetElement(elemId);

                            if (element == null)
                            {
                                Console.WriteLine($"Element not found: dbId={transform.DbId}, name={transform.ElementName}");
                                failCount++;
                                continue;
                            }

                            if (element.Location is LocationPoint locationPoint)
                            {
                                // Calculate the offset from original to new position
                                XYZ originalPos = new XYZ(
                                    transform.OriginalPosition.X / 12.0, // Convert inches to feet
                                    transform.OriginalPosition.Y / 12.0,
                                    transform.OriginalPosition.Z / 12.0
                                );

                                XYZ newPos = new XYZ(
                                    transform.NewPosition.X / 12.0, // Convert inches to feet
                                    transform.NewPosition.Y / 12.0,
                                    transform.NewPosition.Z / 12.0
                                );

                                XYZ offset = newPos - originalPos;

                                // Move the element
                                XYZ currentPoint = locationPoint.Point;
                                locationPoint.Point = currentPoint + offset;

                                Console.WriteLine($"Moved element {transform.ElementName}: offset=({offset.X:F3}, {offset.Y:F3}, {offset.Z:F3}) ft");
                                successCount++;
                            }
                            else if (element.Location is LocationCurve)
                            {
                                Console.WriteLine($"Element {transform.ElementName} has LocationCurve - not yet implemented");
                                failCount++;
                            }
                            else
                            {
                                Console.WriteLine($"Element {transform.ElementName} has no movable location");
                                failCount++;
                            }
                        }
                        catch (Exception ex)
                        {
                            Console.WriteLine($"Error processing element {transform.ElementName}: {ex.Message}");
                            failCount++;
                        }
                    }

                    trans.Commit();

                    Console.WriteLine($"Transform complete: {successCount} succeeded, {failCount} failed");
                }

                // Save the modified document
                string outputPath = Path.Combine(Directory.GetCurrentDirectory(), "output.rvt");
                doc.SaveAs(outputPath);
                Console.WriteLine($"Saved modified document to: {outputPath}");

                return true;
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Fatal error: {ex.Message}");
                Console.WriteLine($"Stack trace: {ex.StackTrace}");
                return false;
            }
        }
    }

    // Data models for JSON deserialization
    public class TransformData
    {
        [JsonProperty("transforms")]
        public List<ElementTransform> Transforms { get; set; }
    }

    public class ElementTransform
    {
        [JsonProperty("dbId")]
        public int DbId { get; set; }

        [JsonProperty("elementName")]
        public string ElementName { get; set; }

        [JsonProperty("originalPosition")]
        public Position OriginalPosition { get; set; }

        [JsonProperty("newPosition")]
        public Position NewPosition { get; set; }
    }

    public class Position
    {
        [JsonProperty("x")]
        public double X { get; set; }

        [JsonProperty("y")]
        public double Y { get; set; }

        [JsonProperty("z")]
        public double Z { get; set; }
    }
}
