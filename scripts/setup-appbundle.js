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

const https = require('https');
const fs = require('fs');
const path = require('path');

// Configuration
const CLIENT_ID = process.env.AUTODESK_CLIENT_ID || 'UonGGAilCryEuzl6kCD2owAcIiFZXobglVyZamHkTktJg2AY';
const CLIENT_SECRET = process.env.AUTODESK_CLIENT_SECRET;
const APPBUNDLE_NAME = 'RevitTransformApp';
const ACTIVITY_NAME = 'RevitTransformActivity';
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
          const response = body ? JSON.parse(body) : {};
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ statusCode: res.statusCode, data: response });
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${body}`));
          }
        } catch (e) {
          reject(new Error(`Failed to parse response: ${body}`));
        }
      });
    });

    req.on('error', reject);
    if (data) req.write(typeof data === 'string' ? data : JSON.stringify(data));
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

  const result = await makeRequest(options, versionSpec);
  console.log('✅ New AppBundle version created');
  return result.data;
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

  const options = {
    hostname: uploadUrl.hostname,
    path: uploadUrl.pathname + uploadUrl.search,
    method: 'PUT',
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Length': zipData.length
    }
  };

  await makeRequest(options, zipData);
  console.log('✅ AppBundle ZIP uploaded');
}

// Get latest AppBundle version
async function getLatestAppBundleVersion(token) {
  console.log('\n🔍 Getting latest AppBundle version...');
  
  const options = {
    hostname: 'developer.api.autodesk.com',
    path: `/da/us-east/v3/appbundles/${APPBUNDLE_NAME}/versions`,
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`
    }
  };

  const result = await makeRequest(options);
  const versions = result.data.data || [];
  const latestVersion = Math.max(...versions);
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
    path: `/da/us-east/v3/appbundles/${APPBUNDLE_NAME}/aliases/v1`,
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
      aliasSpec.id = 'v1';
      
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
    appbundles: [`${CLIENT_ID}.${APPBUNDLE_NAME}+v1`],
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
    appbundles: [`${CLIENT_ID}.${APPBUNDLE_NAME}+v1`],
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
    path: `/da/us-east/v3/activities/${ACTIVITY_NAME}/aliases/v1`,
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
      aliasSpec.id = 'v1';
      
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
    
    if (appBundle.uploadParameters) {
      await uploadAppBundle(token, appBundle.uploadParameters);
    } else {
      console.log('⚠️  No upload needed (AppBundle already exists)');
    }
    
    // Get latest AppBundle version and update alias
    const latestAppBundleVersion = await getLatestAppBundleVersion(token);
    await createOrUpdateAppBundleAlias(token, latestAppBundleVersion);
    
    await createActivity(token);
    
    // Get latest Activity version and update alias
    const latestActivityVersion = await getLatestActivityVersion(token);
    await createOrUpdateActivityAlias(token, latestActivityVersion);

    console.log('\n✨ Setup completed successfully!');
    console.log('\n📋 Summary:');
    console.log(`   AppBundle: ${CLIENT_ID}.${APPBUNDLE_NAME}+v1 (→ version ${latestAppBundleVersion})`);
    console.log(`   Activity: ${CLIENT_ID}.${ACTIVITY_NAME}+v1 (→ version ${latestActivityVersion})`);
    console.log('\n🎉 Your edge function is now ready to use Design Automation!');
    console.log('   Try moving an element in the viewer and clicking Save.');

  } catch (error) {
    console.error('\n❌ Setup failed:', error.message);
    process.exit(1);
  }
}

// Run setup
setup();
