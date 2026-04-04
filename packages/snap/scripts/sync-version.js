/**
 * Synchronizes `snap.manifest.json` `version` with `package.json` when running the `version` npm script.
 */
const fs = require('fs');
const path = require('path');

// Read the version from package.json
const packageJson = require('../package.json');

const { version } = packageJson;

// Path to snap.manifest.json
const manifestPath = path.join(__dirname, '../snap.manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

// Keep snap.manifest.json in sync with package.json
if (manifest.version !== version) {
  manifest.version = version;
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`✅ Updated snap.manifest.json to version ${version}.`);
} else {
  console.log('ℹ️ Version is already in sync.');
}
