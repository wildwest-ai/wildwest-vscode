#!/usr/bin/env node
/**
 * migrate-filenames.js
 * Renames all legacy wire files (timestamp/slug names) to {wwuid}.json.
 * Pass --write to apply; dry-run by default.
 */

const fs   = require('fs');
const path = require('path');
const os   = require('os');

const WRITE = process.argv.includes('--write');
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.json$/;

const dirs = [
  path.join(os.homedir(), 'wildwest', 'telegraph', 'flat'),
  path.join(os.homedir(), 'wildwest', 'counties', 'wildwest-ai', 'wildwest-vscode', '.wildwest', 'telegraph', 'flat'),
  path.join(os.homedir(), 'wildwest', 'counties', 'wildwest-ai', '.wildwest', 'telegraph', 'flat'),
];

for (const dir of dirs) {
  let files;
  try { files = fs.readdirSync(dir); } catch { continue; }
  console.log('\n=== ' + dir);
  let changed = 0;
  for (const f of files) {
    if (!f.endsWith('.json') || f.startsWith('.') || f.startsWith('_') || f === 'index.json') continue;
    if (UUID_RE.test(f)) continue;
    const filePath = path.join(dir, f);
    let wire;
    try { wire = JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { console.log('  SKIP (bad JSON): ' + f); continue; }
    const wwuid = wire.wwuid;
    if (!wwuid) { console.log('  SKIP (no wwuid): ' + f); continue; }
    const dest = path.join(dir, wwuid + '.json');
    if (fs.existsSync(dest)) {
      console.log('  SKIP (dest exists): ' + f + ' -> ' + wwuid + '.json');
      continue;
    }
    console.log('  RENAME: ' + f + ' -> ' + wwuid + '.json');
    if (WRITE) fs.renameSync(filePath, dest);
    changed++;
  }
  if (changed === 0) console.log('  (nothing to rename)');
}

if (!WRITE) console.log('\nDry-run. Pass --write to apply.');
else        console.log('\nDone.');
