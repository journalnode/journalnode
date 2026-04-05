const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const srcDir = path.join(__dirname, '..', 'src');
const testFiles = fs.readdirSync(srcDir)
  .filter(name => name.endsWith('.test.js'))
  .sort();

for (const file of testFiles) {
  const fullPath = path.join(srcDir, file);
  const result = spawnSync(process.execPath, [fullPath], { stdio: 'inherit' });
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}
