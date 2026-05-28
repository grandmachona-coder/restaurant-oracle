'use strict';

// Unified smoke runner — runs every _test_*.js suite in this directory.
// Exit code = number of failed suites.
// Run: node firebase/functions/_test_all.js

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const dir = __dirname;
const files = fs.readdirSync(dir)
  .filter(f => /^_test_.+\.js$/.test(f) && f !== '_test_all.js')
  .sort();

if (files.length === 0) {
  console.error('No _test_*.js files found in ' + dir);
  process.exit(1);
}

let failed = 0;
let totalPassed = 0;
let totalFailed = 0;

console.log('Running ' + files.length + ' suite(s):');
console.log('');

for (const f of files) {
  console.log('───────────────────────────────────────────');
  console.log('▶ ' + f);
  console.log('───────────────────────────────────────────');
  const r = spawnSync('node', [path.join(dir, f)], { stdio: 'inherit' });
  if (r.status !== 0) failed++;
  console.log('');
}

console.log('═══════════════════════════════════════════');
console.log('Suites: ' + (files.length - failed) + '/' + files.length + ' passed');
console.log('═══════════════════════════════════════════');
process.exit(failed);
