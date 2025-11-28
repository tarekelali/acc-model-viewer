/**
 * Autodesk Design Automation AppBundle Setup Script
 * 
 * This script automates the registration of the AppBundle and Activity
 * with Autodesk's Design Automation API.
 * 
 * Prerequisites:
 * 1. You must have compiled the Revit plugin and created RevitTransformPlugin.zip
 * 2. Place the ZIP file in the root directory of this project
 * 3. Set your AUTODESK_CLIENT_ID and AUTODESK_CLIENT_SECRET as environment variables
 * 
 * Usage:
 *   node scripts/setup-appbundle.js
 */

import https from 'https';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Get __dirname equivalent for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const CLIENT_ID = process.env.AUTODESK_CLIENT_ID || 'UonGGAilCryEuzl6kCD2owAcIiFZXobglVyZamHkTktJg2AY';
const CLIENT_SECRET = process.env.AUTODESK_CLIENT_SECRET;
const APPBUNDLE_NAME = 'RevitTransformAppV2';
const ACTIVITY_NAME = 'RevitTransformActivityV2';
const ENGINE = 'Autodesk.Revit+2025';
const ZIP_PATH = path.join(__dirname, '..', 'RevitTransformPlugin.zip');

if (!CLIENT_SECRET) {
  console.error('❌ Error: AUTODESK_CLIENT_SECRET environment variable is required');
  console.error('Set it with: export AUTODESK_CLIENT_SECRET=your_secret_here');
  process.exit(1);
}

if (!fs.existsSync(ZIP_PATH)) {
  console.error(`❌ Error: RevitTransformPlugin.zip not found at ${ZIP_PATH}`);
  console.error('Please compile the Revit plugin and place the ZIP file in the root directory');
  process.exit(1);
}

// Helper function to make HTTPS requests
function makeRequest(options, data = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          // For binary uploads (PUT with octet-stream), empty body is success
          if (res.statusCode >= 200 && res.statusCode < 300) {
            const response = body ? JSON.parse(body) : {};
            resolve({ statusCode: res.statusCode, data: response });
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${body}`));
          }
        } catch (e) {
          // If response is not JSON (e.g., XML error), return the raw body
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ statusCode: res.statusCode, data: body || {} });
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${body}`));
          }
        }
      });
    });

    req.on('error', reject);
    if (data) {
      // Handle Buffer (binary data) directly
      if (Buffer.isBuffer(data)) {
        req.write(data);
      } else if (typeof data === 'string') {
        req.write(data);
      } else {
        req.write(JSON.stringify(data));
      }
    }
    req.end();
  });
}

// Get OAuth token
async function getAccessToken() {
  console.log('🔑 Getting access token...');
  
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    grant_type: 'client_credentials',
    scope: 'code:all'
  });

  const options = {
    hostname: 'developer.api.autodesk.com',
    path: '/authentication/v2/token',
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    }
  };

  const result = await makeRequest(options, params.toString());
  console.log('✅ Access token obtained');
  return result.data.access_token;
}

// Create new AppBundle version
async function createAppBundleVersion(token) {
  console.log('⚠️  AppBundle already exists, creating new version...');
  
  const versionSpec = {
    engine: ENGINE,
    description: 'Revit plugin for transforming element positions'
  };

  const options = {
    hostname: 'developer.api.autodesk.com',
    path: `/da/us-east/v3/appbundles/${APPBUNDLE_NAME}/versions`,
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  };

  try {
    const result = await makeRequest(options, versionSpec);
    console.log('✅ New AppBundle version created');
    
    // Log the response structure for debugging
    console.log('\n📋 Version creation response:');
    console.log(`   Version: ${result.data.version || 'N/A'}`);
    console.log(`   Has uploadParameters: ${!!result.data.uploadParameters}`);
    
    if (result.data.uploadParameters) {
      console.log(`   Upload endpoint: ${result.data.uploadParameters.endpointURL}`);
    } else {
      console.log('   ⚠️  WARNING: No uploadParameters in response!');
      console.log('   Full response keys:', Object.keys(result.data));
    }
    
    return result.data;
  } catch (error) {
    // Handle maximum versions limit (403 error)
    if (error.message.includes('403') && error.message.toLowerCase().includes('maximum')) {
      console.log('⚠️  Maximum versions limit reached (100), triggering cleanup...');
      await cleanupOldVersions(token, 10);
      
      // Retry version creation after cleanup
      console.log('🔄 Retrying version creation...');
      const result = await makeRequest(options, versionSpec);
      console.log('✅ New AppBundle version created after cleanup');
      
      console.log('\n📋 Version creation response:');
      console.log(`   Version: ${result.data.version || 'N/A'}`);
      console.log(`   Has uploadParameters: ${!!result.data.uploadParameters}`);
      
      return result.data;
    }
    throw error;
  }
}

// Create AppBundle
async function createAppBundle(token) {
  console.log('\n📦 Creating AppBundle...');
  
  const appBundleSpec = {
    id: APPBUNDLE_NAME,
    engine: ENGINE,
    description: 'Revit plugin for transforming element positions'
  };

  const options = {
    hostname: 'developer.api.autodesk.com',
    path: '/da/us-east/v3/appbundles',
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  };

  try {
    const result = await makeRequest(options, appBundleSpec);
    console.log('✅ AppBundle created');
    return result.data;
  } catch (error) {
    if (error.message.includes('409')) {
      return await createAppBundleVersion(token);
    }
    throw error;
  }
}

// Upload AppBundle ZIP
async function uploadAppBundle(token, uploadParams) {
  console.log('\n📤 Uploading AppBundle ZIP...');
  
  const zipData = fs.readFileSync(ZIP_PATH);
  const uploadUrl = new URL(uploadParams.endpointURL);

  // S3 POST form upload requires multipart form data
  const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2);
  const formData = uploadParams.formData;
  
  // Build multipart form body
  let body = '';
  
  // Add all form fields
  for (const [key, value] of Object.entries(formData)) {
    body += `--${boundary}\r\n`;
    body += `Content-Disposition: form-data; name="${key}"\r\n\r\n`;
    body += `${value}\r\n`;
  }
  
  // Add file field
  body += `--${boundary}\r\n`;
  body += `Content-Disposition: form-data; name="file"; filename="RevitTransformPlugin.zip"\r\n`;
  body += `Content-Type: application/octet-stream\r\n\r\n`;
  
  // Convert body start to buffer, append file, then add closing boundary
  const bodyStart = Buffer.from(body, 'utf8');
  const bodyEnd = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
  const fullBody = Buffer.concat([bodyStart, zipData, bodyEnd]);

  const options = {
    hostname: uploadUrl.hostname,
    path: uploadUrl.pathname,
    method: 'POST',
    headers: {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': fullBody.length
    }
  };

  await makeRequest(options, fullBody);
  console.log('✅ AppBundle ZIP uploaded');
}

// List all AppBundle versions
async function listAppBundleVersions(token) {
  const options = {
    hostname: 'developer.api.autodesk.com',
    path: `/da/us-east/v3/appbundles/${APPBUNDLE_NAME}/versions`,
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`
    }
  };

  const result = await makeRequest(options);
  return result.data.data || [];
}

// Delete a specific AppBundle version
async function deleteAppBundleVersion(token, version) {
  const options = {
    hostname: 'developer.api.autodesk.com',
    path: `/da/us-east/v3/appbundles/${APPBUNDLE_NAME}/versions/${version}`,
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${token}`
    }
  };

  await makeRequest(options);
}

// Cleanup old AppBundle versions, keeping only the latest N versions
async function cleanupOldVersions(token, keepCount = 10) {
  console.log(`\n🗑️  Cleaning up old AppBundle versions (keeping latest ${keepCount})...`);
  
  const versions = await listAppBundleVersions(token);
  console.log(`   Found ${versions.length} total versions`);
  
  if (versions.length <= keepCount) {
    console.log(`   No cleanup needed (${versions.length} <= ${keepCount})`);
    return;
  }
  
  // Sort versions numerically (newest first)
  const sortedVersions = versions.sort((a, b) => b - a);
  const versionsToDelete = sortedVersions.slice(keepCount);
  
  console.log(`   Deleting ${versionsToDelete.length} old versions...`);
  
  for (const version of versionsToDelete) {
    try {
      await deleteAppBundleVersion(token, version);
      console.log(`   ✅ Deleted version ${version}`);
    } catch (error) {
      console.log(`   ⚠️  Failed to delete version ${version}: ${error.message}`);
    }
  }
  
  console.log(`✅ Cleanup complete. Deleted ${versionsToDelete.length} versions, kept ${keepCount} latest`);
}

// Get latest AppBundle version
async function getLatestAppBundleVersion(token) {
  console.log('\n🔍 Getting latest AppBundle version...');
  
  const versions = await listAppBundleVersions(token);
  console.log(`   Available versions: ${versions.join(', ')}`);
  const latestVersion = versions.length > 0 ? Math.max(...versions) : 1;
  console.log(`✅ Latest AppBundle version: ${latestVersion}`);
  return latestVersion;
}

// Create or update AppBundle alias
async function createOrUpdateAppBundleAlias(token, version) {
  console.log(`\n🏷️  Updating AppBundle alias to version ${version}...`);
  
  const aliasSpec = {
    version: version
  };

  // Try to update existing alias first (PATCH)
  let options = {
    hostname: 'developer.api.autodesk.com',
    path: `/da/us-east/v3/appbundles/${APPBUNDLE_NAME}/aliases/1`,
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  };

  try {
    await makeRequest(options, aliasSpec);
    console.log('✅ AppBundle alias updated to latest version');
  } catch (error) {
    if (error.message.includes('404')) {
      // Alias doesn't exist, create it
      console.log('⚠️  Alias not found, creating new alias...');
      options.method = 'POST';
      options.path = `/da/us-east/v3/appbundles/${APPBUNDLE_NAME}/aliases`;
      aliasSpec.id = '1';
      
      await makeRequest(options, aliasSpec);
      console.log('✅ AppBundle alias created');
    } else {
      throw error;
    }
  }
}

// Create new Activity version
async function createActivityVersion(token) {
  console.log('⚠️  Activity already exists, creating new version...');
  
  const activitySpec = {
    engine: ENGINE,
    commandLine: [`$(engine.path)\\\\revitcoreconsole.exe /i "$(args[inputFile].path)" /al "$(appbundles[${APPBUNDLE_NAME}].path)"`],
    appbundles: [`${CLIENT_ID}.${APPBUNDLE_NAME}+1`],
    parameters: {
      inputFile: {
        verb: 'get',
        description: 'Input Revit file',
        localName: 'input.rvt',
        required: true
      },
      transforms: {
        verb: 'get',
        description: 'Transform data JSON',
        localName: 'transforms.json',
        required: true
      },
      outputFile: {
        verb: 'put',
        description: 'Output Revit file',
        localName: 'output.rvt',
        required: true
      }
    }
  };

  const options = {
    hostname: 'developer.api.autodesk.com',
    path: `/da/us-east/v3/activities/${ACTIVITY_NAME}/versions`,
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  };

  await makeRequest(options, activitySpec);
  console.log('✅ New Activity version created');
}

// Create Activity
async function createActivity(token) {
  console.log('\n⚙️  Creating Activity...');
  
  const activitySpec = {
    id: ACTIVITY_NAME,
    engine: ENGINE,
    commandLine: [`$(engine.path)\\\\revitcoreconsole.exe /i "$(args[inputFile].path)" /al "$(appbundles[${APPBUNDLE_NAME}].path)"`],
    appbundles: [`${CLIENT_ID}.${APPBUNDLE_NAME}+1`],
    parameters: {
      inputFile: {
        verb: 'get',
        description: 'Input Revit file',
        localName: 'input.rvt',
        required: true
      },
      transforms: {
        verb: 'get',
        description: 'Transform data JSON',
        localName: 'transforms.json',
        required: true
      },
      outputFile: {
        verb: 'put',
        description: 'Output Revit file',
        localName: 'output.rvt',
        required: true
      }
    }
  };

  const options = {
    hostname: 'developer.api.autodesk.com',
    path: '/da/us-east/v3/activities',
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  };

  try {
    await makeRequest(options, activitySpec);
    console.log('✅ Activity created');
  } catch (error) {
    if (error.message.includes('409')) {
      await createActivityVersion(token);
    } else {
      throw error;
    }
  }
}

// Get latest Activity version
async function getLatestActivityVersion(token) {
  console.log('\n🔍 Getting latest Activity version...');
  
  const options = {
    hostname: 'developer.api.autodesk.com',
    path: `/da/us-east/v3/activities/${ACTIVITY_NAME}/versions`,
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`
    }
  };

  const result = await makeRequest(options);
  const versions = result.data.data || [];
  const latestVersion = Math.max(...versions);
  console.log(`✅ Latest Activity version: ${latestVersion}`);
  return latestVersion;
}

// Create or update Activity alias
async function createOrUpdateActivityAlias(token, version) {
  console.log(`\n🏷️  Updating Activity alias to version ${version}...`);
  
  const aliasSpec = {
    version: version
  };

  // Try to update existing alias first (PATCH)
  let options = {
    hostname: 'developer.api.autodesk.com',
    path: `/da/us-east/v3/activities/${ACTIVITY_NAME}/aliases/1`,
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  };

  try {
    await makeRequest(options, aliasSpec);
    console.log('✅ Activity alias updated to latest version');
  } catch (error) {
    if (error.message.includes('404')) {
      // Alias doesn't exist, create it
      console.log('⚠️  Alias not found, creating new alias...');
      options.method = 'POST';
      options.path = `/da/us-east/v3/activities/${ACTIVITY_NAME}/aliases`;
      aliasSpec.id = '1';
      
      await makeRequest(options, aliasSpec);
      console.log('✅ Activity alias created');
    } else {
      throw error;
    }
  }
}

// Main setup function
async function setup() {
  console.log('🚀 Starting Autodesk Design Automation Setup\n');
  console.log(`Client ID: ${CLIENT_ID}`);
  console.log(`AppBundle: ${APPBUNDLE_NAME}`);
  console.log(`Activity: ${ACTIVITY_NAME}`);
  console.log(`Engine: ${ENGINE}\n`);

  try {
    const token = await getAccessToken();
    
    const appBundle = await createAppBundle(token);
    const createdVersion = appBundle.version;
    
    // Always attempt upload when creating a new version
    if (appBundle.uploadParameters) {
      await uploadAppBundle(token, appBundle.uploadParameters);
      console.log(`✅ ZIP uploaded for version ${createdVersion}`);
    } else {
      console.log('\n⚠️  WARNING: No upload parameters in response!');
      console.log('   Response structure:', JSON.stringify(appBundle, null, 2));
      console.log('   This version was created but the ZIP was NOT uploaded.');
      console.log('   The version will not work without the ZIP file.');
      throw new Error(`Version ${createdVersion} was created but upload parameters are missing. Cannot proceed.`);
    }
    
    // Use the version we just created instead of querying (which may have propagation delay)
    if (createdVersion) {
      console.log(`\n🏷️  Updating AppBundle alias to version ${createdVersion} (just created)...`);
      await createOrUpdateAppBundleAlias(token, createdVersion);
    } else {
      // Fallback: Get latest AppBundle version and update alias
      console.log('\n⚠️  Version number not in response, querying for latest...');
      const latestAppBundleVersion = await getLatestAppBundleVersion(token);
      await createOrUpdateAppBundleAlias(token, latestAppBundleVersion);
    }
    
    await createActivity(token);
    
    // Get latest Activity version and update alias
    const latestActivityVersion = await getLatestActivityVersion(token);
    await createOrUpdateActivityAlias(token, latestActivityVersion);

    console.log('\n✨ Setup completed successfully!');
    console.log('\n📋 Summary:');
    console.log(`   AppBundle: ${CLIENT_ID}.${APPBUNDLE_NAME}+1 (→ version ${createdVersion || 'unknown'})`);
    console.log(`   Activity: ${CLIENT_ID}.${ACTIVITY_NAME}+1 (→ version ${latestActivityVersion})`);
    console.log('\n🎉 Your edge function is now ready to use Design Automation!');
    console.log('   Try moving an element in the viewer and clicking Save.');

  } catch (error) {
    console.error('\n❌ Setup failed:', error.message);
    process.exit(1);
  }
}

// Run setup
setup();
