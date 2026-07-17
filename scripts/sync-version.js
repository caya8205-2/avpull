const { readFileSync, writeFileSync } = require('fs');

const root = JSON.parse(readFileSync('package.json', 'utf-8'));
const version = root.version;

function writeJson(path, data) {
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n');
}

// Sync CURRENT_VERSION in src/cli.js
const cliPath = 'src/cli.js';
let cli = readFileSync(cliPath, 'utf-8');
cli = cli.replace(
  /const CURRENT_VERSION = '[^']+';/,
  `const CURRENT_VERSION = '${version}';`
);
writeFileSync(cliPath, cli);
console.log(`✅ Updated CURRENT_VERSION in ${cliPath}`);

// Sync npm lockfile workspace package versions without recalculating dependencies.
const lock = JSON.parse(readFileSync('package-lock.json', 'utf-8'));
lock.version = version;
if (lock.packages?.['']) lock.packages[''].version = version;
if (lock.packages?.backend) lock.packages.backend.version = version;
if (lock.packages?.frontend) lock.packages.frontend.version = version;
writeJson('package-lock.json', lock);

console.log(`✅ Synced all to v${version}`);
