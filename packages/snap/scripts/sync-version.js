/* eslint-disable prefer-template */
/* eslint-disable n/no-sync */
/* eslint-disable no-negated-condition */
/* eslint-disable import-x/newline-after-import */
/* eslint-disable prefer-destructuring */
const fs = require('fs');
const path = require('path');

const packageJson = require('../package.json');
const version = packageJson.version;

const manifestPath = path.join(__dirname, '../snap.manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

if (manifest.version !== version) {
  manifest.version = version;
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`✅ snap.manifest.json をバージョン ${version} に更新しました。`);
} else {
  console.log('ℹ️ バージョンは既に同期されています。');
}
