// RevitTransformPlugin.cs
// This C# Revit plugin applies element transformations for Design Automation
// 
// SETUP INSTRUCTIONS:
// 1. Create a new Class Library project in Visual Studio (.NET Framework 4.8)
// 2. Install NuGet packages:
//    - Autodesk.Forge.DesignAutomation.Revit (version 2025.0.0)
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
//   "engine": "Autodesk.Revit+2025",
//   "description": "Applies element transformations"
// }
//
// Activity creation:
// POST https://developer.api.autodesk.com/da/us-east/v3/activities
// {
//   "id": "TransformActivity",
//   "commandLine": ["$(engine.path)\\\\revitcoreconsole.exe /i $(args[inputRvt].path) /al $(appbundles[RevitTransformPlugin].path)"],
//   "engine": "Autodesk.Revit+2025",
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
using System.Text.Json;
using System.Text.Json.Serialization;
using Autodesk.Revit.ApplicationServices;
using Autodesk.Revit.DB;
using DesignAutomationFramework;

namespace RevitTransformPlugin
{
    [Autodesk.Revit.Attributes.Regeneration(Autodesk.Revit.Attributes.RegenerationOption.Manual)]
    [Autodesk.Revit.Attributes.Transaction(Autodesk.Revit.Attributes.TransactionMode.Manual)]
    public class TransformApp : IExternalDBApplication
    {
        // Static constructor - runs when type is first loaded
        static TransformApp()
        {
            Console.WriteLine("=== STATIC CONSTRUCTOR CALLED ===");
            Console.WriteLine("[Static] RevitTransformPlugin.dll loaded successfully");
            Console.WriteLine($"[Static] Assembly location: {typeof(TransformApp).Assembly.Location}");
        }

        public ExternalDBApplicationResult OnStartup(ControlledApplication app)
        {
            Console.WriteLine("=== PLUGIN ONSTARTUP STARTED ===");
            
            try
            {
                // Log plugin assembly version
                var assembly = System.Reflection.Assembly.GetExecutingAssembly();
                var version = assembly.GetName().Version;
                Console.WriteLine($"Plugin Assembly Version: {version}");
                
                // Log Revit version
                if (app != null)
                {
                    Console.WriteLine($"Revit Version: {app.VersionNumber}");
                    Console.WriteLine($"Revit Build: {app.VersionBuild}");
                }
                
                // Subscribe to Design Automation event
                DesignAutomationBridge.DesignAutomationReadyEvent += HandleDesignAutomation;
                Console.WriteLine("✅ Successfully subscribed to DesignAutomationReadyEvent");
                
                Console.WriteLine("=== PLUGIN ONSTARTUP COMPLETED ===");
                return ExternalDBApplicationResult.Succeeded;
            }
            catch (Exception ex)
            {
                Console.WriteLine("=== FATAL ERROR IN ONSTARTUP ===");
                Console.WriteLine($"Error Type: {ex.GetType().Name}");
                Console.WriteLine($"Error Message: {ex.Message}");
                Console.WriteLine($"Stack Trace:\n{ex.StackTrace}");
                
                if (ex.InnerException != null)
                {
                    Console.WriteLine($"Inner Exception Type: {ex.InnerException.GetType().Name}");
                    Console.WriteLine($"Inner Exception Message: {ex.InnerException.Message}");
                    Console.WriteLine($"Inner Stack Trace:\n{ex.InnerException.StackTrace}");
                }
                
                return ExternalDBApplicationResult.Failed;
            }
        }

        public ExternalDBApplicationResult OnShutdown(ControlledApplication app)
        {
            return ExternalDBApplicationResult.Succeeded;
        }

        public void HandleDesignAutomation(object sender, DesignAutomationReadyEventArgs e)
        {
            try
            {
                Console.WriteLine("=== Design Automation Event Triggered ===");
                Console.WriteLine($"Sender: {sender?.GetType().Name ?? "null"}");
                Console.WriteLine($"DesignAutomationData: {(e?.DesignAutomationData != null ? "present" : "null")}");
                
                if (e?.DesignAutomationData?.RevitDoc != null)
                {
                    Console.WriteLine($"Document: {e.DesignAutomationData.RevitDoc.PathName ?? "Unnamed"}");
                }
                
                e.Succeeded = ProcessTransforms(e.DesignAutomationData);
                
                Console.WriteLine($"=== Design Automation Result: {(e.Succeeded ? "SUCCESS" : "FAILED")} ===");
            }
            catch (Exception ex)
            {
                Console.WriteLine($"FATAL ERROR in HandleDesignAutomation: {ex.Message}");
                Console.WriteLine($"Stack trace: {ex.StackTrace}");
                e.Succeeded = false;
            }
        }

        private bool ProcessTransforms(DesignAutomationData data)
        {
            Console.WriteLine("\n=== ProcessTransforms Started ===");
            
            if (data == null)
            {
                Console.WriteLine("ERROR: DesignAutomationData is null");
                return false;
            }

            Document doc = data.RevitDoc;
            if (doc == null)
            {
                Console.WriteLine("ERROR: Document is null");
                return false;
            }

            try
            {
                // Get the directory where the Revit document is located
                // Design Automation downloads all files to the same job directory
                string docDirectory = Path.GetDirectoryName(doc.PathName);
                
                // Debug logging to verify paths
                Console.WriteLine($"Document path: {doc.PathName}");
                Console.WriteLine($"Document directory: {docDirectory ?? "null"}");
                Console.WriteLine($"Current working directory: {Directory.GetCurrentDirectory()}");
                
                // Read transformation data from the same directory as the document
                string transformsPath = Path.Combine(docDirectory ?? Directory.GetCurrentDirectory(), "transforms.json");
                Console.WriteLine($"Looking for transforms.json at: {transformsPath}");
                
                if (!File.Exists(transformsPath))
                {
                    Console.WriteLine($"ERROR: transforms.json not found at: {transformsPath}");
                    Console.WriteLine($"Current directory contents:");
                    try
                    {
                        var files = Directory.GetFiles(Directory.GetCurrentDirectory());
                        foreach (var file in files)
                        {
                            Console.WriteLine($"  - {Path.GetFileName(file)}");
                        }
                    }
                    catch (Exception dirEx)
                    {
                        Console.WriteLine($"  Could not list directory: {dirEx.Message}");
                    }
                    return false;
                }

                string json = File.ReadAllText(transformsPath);
                Console.WriteLine($"Transforms JSON content: {json}");

                // Parse the JSON wrapper that contains the transforms dictionary
                // Edge function sends: { "transforms": { "uniqueId": { "elementId": 123, "uniqueId": "...", "translation": {...} } } }
                var options = new JsonSerializerOptions { PropertyNameCaseInsensitive = true };
                var wrapper = JsonSerializer.Deserialize<TransformsWrapper>(json, options);

                if (wrapper?.Transforms == null || wrapper.Transforms.Count == 0)
                {
                    Console.WriteLine("ERROR: No transforms found in JSON");
                    return false;
                }

                var transformDict = wrapper.Transforms;

                Console.WriteLine($"\n=== Processing {transformDict.Count} transformation(s) ===");

                using (Transaction trans = new Transaction(doc, "Apply Element Transforms"))
                {
                    trans.Start();

                    int successCount = 0;
                    int failCount = 0;

                    foreach (var kvp in transformDict)
                    {
                        try
                        {
                            string elementKey = kvp.Key;  // UniqueId from dictionary key (for reference)
                            ElementTransformData transformData = kvp.Value;

                            Console.WriteLine($"\n--- Processing Transform [{successCount + failCount + 1}/{transformDict.Count}] ---");
                            Console.WriteLine($"  Dictionary Key (UniqueId): {elementKey}");
                            Console.WriteLine($"  Transform ElementId: {transformData.ElementId}");
                            Console.WriteLine($"  Transform UniqueId: {transformData.UniqueId ?? "not provided"}");
                            Console.WriteLine($"  ElementName: {transformData.ElementName ?? "not provided"}");
                            Console.WriteLine($"  Translation Delta: ({transformData.Translation.X:F3}, {transformData.Translation.Y:F3}, {transformData.Translation.Z:F3}) ft");

                            // Use transform.ElementId to look up the element
                            ElementId elementId = new ElementId(transformData.ElementId);
                            Element element = doc.GetElement(elementId);

                            if (element == null)
                            {
                                Console.WriteLine($"ERROR: Element not found by ElementId: {transformData.ElementId}");
                                Console.WriteLine($"  Attempted lookup: ElementId({transformData.ElementId})");
                                Console.WriteLine($"  UniqueId from transform: {transformData.UniqueId ?? "N/A"}");
                                Console.WriteLine($"  Dictionary key: {elementKey}");
                                failCount++;
                                continue;
                            }

                            // Verify we found the correct element by comparing UniqueId if provided
                            if (!string.IsNullOrEmpty(transformData.UniqueId))
                            {
                                string elementUniqueId = element.UniqueId;
                                if (elementUniqueId != transformData.UniqueId)
                                {
                                    Console.WriteLine($"WARNING: UniqueId mismatch!");
                                    Console.WriteLine($"  Expected: {transformData.UniqueId}");
                                    Console.WriteLine($"  Found: {elementUniqueId}");
                                    Console.WriteLine($"  Continuing with found element...");
                                }
                                else
                                {
                                    Console.WriteLine($"✓ UniqueId verified: {elementUniqueId}");
                                }
                            }

                            Console.WriteLine($"✓ Element found: {element.Name ?? "Unnamed"} (Category: {element.Category?.Name ?? "Unknown"}, ElementId: {element.Id.IntegerValue})");

                            // Create translation vector (already in feet from frontend)
                            XYZ offset = new XYZ(
                                transformData.Translation.X,
                                transformData.Translation.Y,
                                transformData.Translation.Z
                            );

                            if (element.Location is LocationPoint locationPoint)
                            {
                                // Move point-based elements
                                locationPoint.Point = locationPoint.Point + offset;
                                Console.WriteLine($"✓ Moved {element.Name}: offset=({offset.X:F3}, {offset.Y:F3}, {offset.Z:F3}) ft");
                                successCount++;
                            }
                            else if (element.Location is LocationCurve)
                            {
                                // Move curve-based elements
                                ElementTransformUtils.MoveElement(doc, element.Id, offset);
                                Console.WriteLine($"✓ Moved {element.Name} (LocationCurve): offset=({offset.X:F3}, {offset.Y:F3}, {offset.Z:F3}) ft");
                                successCount++;
                            }
                            else
                            {
                                // Try ElementTransformUtils for other types
                                try
                                {
                                    ElementTransformUtils.MoveElement(doc, element.Id, offset);
                                    Console.WriteLine($"✓ Moved {element.Name} (other type): offset=({offset.X:F3}, {offset.Y:F3}, {offset.Z:F3}) ft");
                                    successCount++;
                                }
                                catch (Exception moveEx)
                                {
                                    Console.WriteLine($"✗ Failed to move {element.Name}: {moveEx.Message}");
                                    failCount++;
                                }
                            }
                        }
                        catch (Exception ex)
                        {
                            Console.WriteLine($"Error processing element: {ex.Message}");
                            failCount++;
                        }
                    }

                    trans.Commit();

                    Console.WriteLine($"\n=== Transform Summary ===");
                    Console.WriteLine($"  Succeeded: {successCount}");
                    Console.WriteLine($"  Failed: {failCount}");
                    Console.WriteLine($"  Total: {successCount + failCount}");
                }

                // Save the modified document to the same directory
                string outputPath = Path.Combine(docDirectory ?? Directory.GetCurrentDirectory(), "output.rvt");
                Console.WriteLine($"Saving modified document to: {outputPath}");
                
                try
                {
                    doc.SaveAs(outputPath);
                    Console.WriteLine($"✅ Successfully saved modified document to: {outputPath}");
                }
                catch (Exception saveEx)
                {
                    Console.WriteLine($"ERROR: Failed to save document: {saveEx.Message}");
                    Console.WriteLine($"Stack trace: {saveEx.StackTrace}");
                    return false;
                }

                Console.WriteLine("\n=== ProcessTransforms Completed Successfully ===");
                return true;
            }
            catch (Exception ex)
            {
                Console.WriteLine($"\n=== FATAL ERROR in ProcessTransforms ===");
                Console.WriteLine($"Error message: {ex.Message}");
                Console.WriteLine($"Error type: {ex.GetType().Name}");
                Console.WriteLine($"Stack trace:\n{ex.StackTrace}");
                
                if (ex.InnerException != null)
                {
                    Console.WriteLine($"Inner exception: {ex.InnerException.Message}");
                    Console.WriteLine($"Inner stack trace:\n{ex.InnerException.StackTrace}");
                }
                
                return false;
            }
        }
    }

    // Data models for JSON deserialization
    // Edge function wraps transforms in an object
    // Format: { "transforms": { "uniqueId": { "elementId": 123, "uniqueId": "...", "translation": {...} } } }
    public class TransformsWrapper
    {
        [JsonPropertyName("transforms")]
        public Dictionary<string, ElementTransformData> Transforms { get; set; }
    }

    public class ElementTransformData
    {
        [JsonPropertyName("elementId")]
        public int ElementId { get; set; }

        [JsonPropertyName("uniqueId")]
        public string UniqueId { get; set; }

        [JsonPropertyName("elementName")]
        public string ElementName { get; set; }

        [JsonPropertyName("originalPosition")]
        public Vector3 OriginalPosition { get; set; }

        [JsonPropertyName("newPosition")]
        public Vector3 NewPosition { get; set; }

        [JsonPropertyName("translation")]
        public Vector3 Translation { get; set; }
    }

    public class Vector3
    {
        [JsonPropertyName("x")]
        public double X { get; set; }

        [JsonPropertyName("y")]
        public double Y { get; set; }

        [JsonPropertyName("z")]
        public double Z { get; set; }
    }
}















