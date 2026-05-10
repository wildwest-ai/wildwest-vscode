#!/usr/bin/env node
/**
 * migrate-legacy-addresses.js
 *
 * Transforms legacy wire address format in ~/wildwest/telegraph/flat/ JSON files.
 *
 * Legacy:    Role(dyad)[Actor]          e.g. TM(dyad)[wildwest-vscode], CD(dyad)[RSn].Cpt
 * Canonical: Role(Actor)                e.g. TM(wildwest-vscode),       CD(RSn).Cpt
 *
 * Fields migrated: `from`, `to`
 * Dry-run by default — pass --write to apply changes.
 *
 * Usage:
 *   node scripts/migrate-legacy-addresses.js           # dry-run
 *   node scripts/migrate-legacy-addresses.js --write   # apply
 */

const fs   = require('fs');
const path = require('path');
const os   = require('os');

const FLAT_DIR  = path.join(os.homedir(), 'wildwest', 'telegraph', 'flat');
const WRITE_MODE = process.argv.includes('--write');

// Role(dyad)[Content]  or  Role(dyad)[Content].Channel
const LEGACY_RE = /^([A-Za-z]+)\(dyad\)\[([^\]]+)\](\.[\w]+)?$/;

function migrateAddress(addr) {
  if (!addr) return { value: addr, changed: false };
  const m = addr.match(LEGACY_RE);
  if (!m) return { value: addr, changed: false };
  const canonical = m[1] + '(' + m[2] + ')' + (m[3] || '');
  return { value: canonical, changed: true };
}

function processFile(filePath) {
  let raw;
  try { raw = fs.readFileSync(filePath, 'utf8'); }
  catch { console.error('  SKIP (unreadable):', filePath); return; }

  let wire;
  try { wire = JSON.parse(raw); }
  catch { console.error('  SKIP (invalid JSON):', filePath); return; }

  const fromResult = migrateAddress(wire.from);
  const toResult   = migrateAddress(wire.to);

  if (!fromResult.changed && !toResult.changed) return;

  const changes = [];
  if (fromResult.changed) {
    changes.push(`  from: ${wire.from}  →  ${fromResult.value}`);
    wire.from = fromResult.value;
  }
  if (toResult.changed) {
    changes.push(`  to:   ${wire.to}  →  ${toResult.value}`);
    wire.to = toResult.value;
  }

  const shortId = path.basename(filePath, '.json').slice(0, 8);
  console.log(`[${shortId}] ${wire.subject || '(no subject)'}`);
  changes.forEach(c => console.log(c));

  if (WRITE_MODE) {
    fs.writeFileSync(filePath, JSON.stringify(wire, null, 2), 'utf8');
    console.log('  ✓ written');
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

if (!fs.existsSync(FLAT_DIR)) {
  console.error('flat/ directory not found:', FLAT_DIR);
  process.exit(1);
}

const files = fs.readdirSync(FLAT_DIR)
  .filter(f => f.endsWith('.json') && !f.startsWith('.') && f !== 'index.json');

console.log(`Scanning ${files.length} wires in ${FLAT_DIR}`);
console.log(WRITE_MODE ? 'Mode: WRITE\n' : 'Mode: DRY-RUN (pass --write to apply)\n');

let changed = 0;
for (const f of files) {
  const before = changed;
  processFile(path.join(FLAT_DIR, f));
  if (changed > before) changed++;
}

// Re-count for summary
let total = 0;
for (const f of files) {
  const raw = fs.readFileSync(path.join(FLAT_DIR, f), 'utf8');
  let wire; try { wire = JSON.parse(raw); } catch { continue; }
  if (migrateAddress(wire.from).changed || migrateAddress(wire.to).changed) total++;
}

console.log(`\n${WRITE_MODE ? 'Migrated' : 'Would migrate'}: ${total} wires`);
if (!WRITE_MODE && total > 0) console.log('Run with --write to apply.');
