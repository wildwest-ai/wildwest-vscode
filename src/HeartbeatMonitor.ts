import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import {
  type WildWestScope,
  scopeRoleMap,
  resolveRoleToScope as resolveRoleToScopeFromRegistry,
} from './roles/roleRegistry';

export type { WildWestScope };

// Absolute hardcoded floor — 5 min.
// Used when no registry.json and no VS Code setting overrides for a scope.
const FLOOR_MS = 300_000;

// Staleness threshold for .last-beat sentinel: 2× the scope's idle interval.
// Computed per scope at runtime.
const STALE_MULTIPLIER = 2;

export type HeartbeatState = 'alive' | 'flagged' | 'stopped';

// Canonical scope → roles mapping — derived from src/roles/roleRegistry.ts
const SCOPE_ROLES = scopeRoleMap();

interface HeartbeatConfig {
  intervalMs: number;
  intervalActiveMs: number;
}

interface ScopeRoot {
  scope: WildWestScope;
  rootPath: string;
  timer: ReturnType<typeof setInterval> | null;
}

// ---------------------------------------------------------------------------
// Helpers — scope detection & interval resolution
// ---------------------------------------------------------------------------

function readRegistry(rootPath: string): Record<string, unknown> | null {
  const p = path.join(rootPath, '.wildwest', 'registry.json');
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Migrate a registry that lacks schema_version to v2.
 * Adds schema_version, scope, and alias if inferrable from legacy fields.
 * Writes the updated registry back to disk.
 * Returns the migrated registry object.
 */
function migrateRegistry(rootPath: string, reg: Record<string, unknown>): Record<string, unknown> {
  const p = path.join(rootPath, '.wildwest', 'registry.json');
  const updated = { ...reg };

  // Infer scope from legacy fields
  if (!updated['scope']) {
    if (updated['county']) {
      updated['scope'] = 'county';
    } else if (updated['wwuid'] && !updated['county']) {
      // Town registries have wwuid; if no county key, treat as town
      updated['scope'] = 'town';
    }
  }

  // Promote 'county' key to 'alias' if missing
  if (!updated['alias'] && updated['county']) {
    updated['alias'] = updated['county'];
  }

  updated['schema_version'] = '2';

  try {
    fs.writeFileSync(p, JSON.stringify(updated, null, 2) + '\n', 'utf8');
  } catch {
    // Migration write failed — proceed with in-memory result
  }

  return updated;
}

/**
 * Migrate a v2 registry to v3.
 * Renames actors → identities; within each entry: actor → dyad, drops channel.
 */
function migrateToV3(rootPath: string, reg: Record<string, unknown>): Record<string, unknown> {
  const p = path.join(rootPath, '.wildwest', 'registry.json');
  const updated = { ...reg };

  if (Array.isArray(updated['actors'])) {
    updated['identities'] = (updated['actors'] as Array<Record<string, unknown>>).map(a => {
      const entry: Record<string, unknown> = {};
      if (a['role']) entry['role'] = a['role'];
      if (a['actor']) entry['dyad'] = a['actor'];
      else if (a['identity']) entry['dyad'] = a['identity'];
      return entry;
    });
    delete updated['actors'];
  } else if (!('identities' in updated)) {
    updated['identities'] = [];
  }

  updated['schema_version'] = '3';

  try {
    fs.writeFileSync(p, JSON.stringify(updated, null, 2) + '\n', 'utf8');
  } catch {
    // Migration write failed — proceed with in-memory result
  }

  return updated;
}

function readMigratedRegistry(rootPath: string): Record<string, unknown> | null {
  let reg = readRegistry(rootPath);
  if (!reg) return null;
  if (!reg['schema_version']) {
    reg = migrateRegistry(rootPath, reg);
  }
  if (reg['schema_version'] === '2') {
    reg = migrateToV3(rootPath, reg);
  }
  return reg;
}

/**
 * Update territory SSOT flat/ wire to status 'received' when it arrives at the destination.
 * Called after wire is delivered to destination inbox/.
 * Sets received_at + appends 'received' transition in territory SSOT.
 * No local cache copy is written — territory is the single source of truth.
 */
function updateDestinationFlatWire(
  destPath: string,
  memoPath: string,
  memoFile: string,
  outputChannel: vscode.OutputChannel,
  worldRoot: string,
): void {
  if (!memoFile.endsWith('.json')) return;

  try {
    let wire: Record<string, unknown>;
    try {
      wire = JSON.parse(fs.readFileSync(memoPath, 'utf8')) as Record<string, unknown>;
    } catch {
      outputChannel.appendLine(`[HeartbeatMonitor] failed to read wire from ${memoFile}`);
      return;
    }

    // Extract wwuid or derive from filename
    let wwuid = wire['wwuid'] as string | undefined;
    if (!wwuid) {
      wwuid = memoFile.replace('.json', '');
      wire['wwuid'] = wwuid;
    }

    // Update territory SSOT: wire has arrived at recipient — status -> 'received'.
    // received_at records the delivery moment.
    const receivedAt = wire['received_at'] as string | undefined || new Date().toISOString();
    wire['received_at'] = receivedAt;
    wire['status'] = 'received';

    const transitions = Array.isArray(wire['status_transitions'])
      ? wire['status_transitions'] as Array<Record<string, unknown>>
      : [];
    const alreadyHasReceived = transitions.some((t) => t['status'] === 'received');
    if (!alreadyHasReceived) {
      transitions.push({ status: 'received', timestamp: receivedAt, repos: ['vscode'] });
      wire['status_transitions'] = transitions;
    }

    // Write back to territory flat/ (not destination local)
    const territoryFlatDir = path.join(worldRoot, 'telegraph', 'flat');
    const territoryWirePath = path.join(territoryFlatDir, `${wwuid}.json`);
    if (fs.existsSync(territoryWirePath)) {
      fs.writeFileSync(territoryWirePath, JSON.stringify(wire, null, 2), 'utf8');
      outputChannel.appendLine(`[HeartbeatMonitor] territory wire → received: ${wwuid}.json`);
    }
  } catch (err) {
    outputChannel.appendLine(`[HeartbeatMonitor] failed to update destination flat wire: ${err}`);
  }
}

function updateFlatWireDeliveryStatus(worldRoot: string, memoPath: string, memoFile: string, outputChannel: vscode.OutputChannel): void {
  if (!memoFile.endsWith('.json')) return;

  const flatDir = path.join(worldRoot, 'telegraph', 'flat');
  fs.mkdirSync(flatDir, { recursive: true });

  let wirePath: string | null = null;
  const targetPath = path.join(flatDir, memoFile);
  if (fs.existsSync(targetPath)) {
    wirePath = targetPath;
  } else {
    // Fall back to locate the wire by wwuid or filename inside flat/.
    const candidates = fs.readdirSync(flatDir).filter((f) => f.endsWith('.json'));
    let currentMemo: Record<string, unknown> | null = null;
    try {
      currentMemo = JSON.parse(fs.readFileSync(memoPath, 'utf8')) as Record<string, unknown>;
    } catch {
      currentMemo = null;
    }
    const targetWwuid = currentMemo?.['wwuid'] as string | undefined;
    const targetFilename = currentMemo?.['filename'] as string | undefined || memoFile;

    for (const candidate of candidates) {
      const candidatePath = path.join(flatDir, candidate);
      try {
        const candidateWire = JSON.parse(fs.readFileSync(candidatePath, 'utf8')) as Record<string, unknown>;
        if (candidate === memoFile || candidateWire['wwuid'] === targetWwuid || candidateWire['filename'] === targetFilename) {
          wirePath = candidatePath;
          break;
        }
      } catch {
        continue;
      }
    }
  }

  if (!wirePath) {
    try {
      const wire = JSON.parse(fs.readFileSync(memoPath, 'utf8')) as Record<string, unknown>;
      // Operator dispatched wire — territory SSOT status is 'sent'
      wire['status'] = 'sent';
      wire['sent_at'] = wire['sent_at'] || new Date().toISOString();
      const transitions = Array.isArray(wire['status_transitions']) ? wire['status_transitions'] as Array<Record<string, unknown>> : [];
      transitions.push({ status: 'sent', timestamp: wire['sent_at'], repos: ['vscode'] });
      wire['status_transitions'] = transitions;
      fs.writeFileSync(targetPath, JSON.stringify(wire, null, 2), 'utf8');
      outputChannel.appendLine(`[HeartbeatMonitor] flat wire created: ${memoFile} in territory SSOT (status: sent)`);
      return;
    } catch (err) {
      outputChannel.appendLine(`[HeartbeatMonitor] failed to create flat wire for ${memoFile}: ${err}`);
      return;
    }
  }

  try {
    const wire = JSON.parse(fs.readFileSync(wirePath, 'utf8')) as Record<string, unknown>;
    // Operator dispatched wire — territory SSOT status is 'sent'
    wire['status'] = 'sent';
    wire['sent_at'] = wire['sent_at'] || new Date().toISOString();
    const transitions = Array.isArray(wire['status_transitions']) ? wire['status_transitions'] as Array<Record<string, unknown>> : [];
    transitions.push({ status: 'sent', timestamp: wire['sent_at'], repos: ['vscode'] });
    wire['status_transitions'] = transitions;
    fs.writeFileSync(wirePath, JSON.stringify(wire, null, 2), 'utf8');
    outputChannel.appendLine(`[HeartbeatMonitor] flat wire updated: ${path.basename(wirePath)} → sent`);
  } catch (err) {
    outputChannel.appendLine(`[HeartbeatMonitor] failed to update flat wire status for ${memoFile}: ${err}`);
  }
}

function scopeOf(rootPath: string): WildWestScope | null {
  const reg = readMigratedRegistry(rootPath);
  if (!reg) return null;

  const s = reg['scope'];
  if (s === 'town' || s === 'county' || s === 'territory') return s;
  return null;
}

/**
 * Read the alias from a .wildwest/registry.json at the given rootPath.
 * Returns null if the registry is missing or unreadable.
 */
function readRegistryAlias(rootPath: string): string | null {
  try {
    const reg = JSON.parse(
      fs.readFileSync(path.join(rootPath, '.wildwest', 'registry.json'), 'utf8'),
    ) as Record<string, unknown>;
    return (reg['alias'] as string) || null;
  } catch {
    return null;
  }
}

/**
 * Walk parent directories from townRoot to find the nearest county root.
 * A county root is a directory containing .wildwest/registry.json with scope === 'county'.
 * Returns the county rootPath or null if not found.
 */
function findCountyRoot(townRoot: string): string | null {
  let current = path.dirname(townRoot);
  const fsRoot = path.parse(current).root;
  while (current !== fsRoot) {
    if (scopeOf(current) === 'county') {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) break; // at filesystem root
    current = parent;
  }
  return null;
}

/**
 * Validate if an identity role is valid for a given scope.
 * Returns true if role is in SCOPE_ROLES mapping for that scope.
 */
function isValidRoleForScope(role: string, scope: WildWestScope): boolean {
  const validRoles = SCOPE_ROLES[scope] || [];
  return validRoles.includes(role);
}

/**
 * Walk ancestor directories from startPath upward looking for a .wildwest/registry.json
 * whose scope field matches targetScope. Returns the matching directory path or null.
 */
function walkUpForScope(startPath: string, targetScope: WildWestScope): string | null {
  let current = path.dirname(startPath);
  const root = path.parse(current).root;
  while (current !== root) {
    const s = scopeOf(current);
    if (s === targetScope) return current;
    current = path.dirname(current);
  }
  return null;
}

/** Extension settings for a given scope, falling back to FLOOR_MS. */
function settingsConfig(scope: WildWestScope): HeartbeatConfig {
  const cfg = vscode.workspace.getConfiguration('wildwest.heartbeat');
  return {
    intervalMs: cfg.get<number>(`${scope}.intervalMs`, FLOOR_MS),
    intervalActiveMs: cfg.get<number>(`${scope}.intervalActiveMs`, FLOOR_MS),
  };
}

/** Resolve effective config: registry ?? extension settings ?? floor. */
function resolveConfig(rootPath: string, scope: WildWestScope): HeartbeatConfig {
  const reg = readRegistry(rootPath);
  const settings = settingsConfig(scope);
  if (reg && reg['heartbeat'] !== null && reg['heartbeat'] !== undefined) {
    const hb = reg['heartbeat'] as Record<string, number>;
    return {
      intervalMs: hb['interval_ms'] ?? settings.intervalMs,
      intervalActiveMs: hb['interval_active_ms'] ?? settings.intervalActiveMs,
    };
  }
  // null means "delegate upward" — or key absent means "inherit"
  return settings;
}

/** Returns true if this scope has active branches. */
function hasActiveBranches(rootPath: string): boolean {
  const reg = readRegistry(rootPath);
  if (!reg) return false;
  const ab = reg['active_branches'];
  if (Array.isArray(ab)) return ab.length > 0;
  if (ab && typeof ab === 'object') return Object.keys(ab).length > 0;
  return false;
}

/** Effective interval for a scope root at this moment. */
function effectiveIntervalMs(rootPath: string, scope: WildWestScope): number {
  const cfg = resolveConfig(rootPath, scope);
  return hasActiveBranches(rootPath) ? cfg.intervalActiveMs : cfg.intervalMs;
}

/** Sentinel path for a scope root. */
function sentinelPath(rootPath: string, scope: WildWestScope): string {
  if (scope === 'town') {
    // Town sentinel lives in telegraph/ (v2 compat)
    return path.join(rootPath, '.wildwest', 'telegraph', '.last-beat');
  }
  return path.join(rootPath, '.wildwest', '.last-beat');
}

/** Write sentinel file, creating parent dirs as needed. */
function writeSentinel(sentinelFile: string, outputChannel: vscode.OutputChannel): void {
  try {
    fs.mkdirSync(path.dirname(sentinelFile), { recursive: true });
    fs.writeFileSync(sentinelFile, new Date().toISOString() + '\n');
  } catch (err) {
    outputChannel.appendLine(`[HeartbeatMonitor] sentinel write error: ${err}`);
  }
}

// ---------------------------------------------------------------------------
// Per-scope beat logic
// ---------------------------------------------------------------------------

/**
 * Scan telegraphDir for resolved wire pairs (ack-done/ack-deferred + original).
 * Move pairs to history/ (create if needed). Leave ack-blocked/ack-question in place.
 * Returns { archived, open }.
 */
function cleanupTelegraph(
  telegraphDir: string,
  outputChannel: vscode.OutputChannel,
): { archived: number; open: number } {
  let archived = 0;
  let open = 0;

  try {
    if (!fs.existsSync(telegraphDir)) return { archived, open };

    const entries = fs.readdirSync(telegraphDir);
    const ackFiles = entries.filter(
      (e) => e.includes('ack-done--') || e.includes('ack-deferred--'),
    );

    for (const ackFile of ackFiles) {
      try {
        // Extract subject from ack file: match pattern like "20260505-1824Z-ack-done--subject.md"
        let subject: string | null = null;
        if (ackFile.includes('ack-done--')) {
          subject = ackFile.split('ack-done--')[1]?.replace('.md', '');
        } else if (ackFile.includes('ack-deferred--')) {
          subject = ackFile.split('ack-deferred--')[1]?.replace('.md', '');
        }
        if (!subject) continue;
        // Try to find the paired memo (scan for anything with same subject)
        const paired = entries.find(
          (e) => e !== ackFile && e.includes(`--${subject}.md`),
        );

        const ackPath = path.join(telegraphDir, ackFile);
        const historyDir = path.join(telegraphDir, 'history');

        // Ensure history/ exists
        if (!fs.existsSync(historyDir)) {
          fs.mkdirSync(historyDir, { recursive: true });
        }

        // Move ack file
        fs.renameSync(ackPath, path.join(historyDir, ackFile));
        archived++;

        // Move paired memo if found
        if (paired) {
          const pairedPath = path.join(telegraphDir, paired);
          fs.renameSync(pairedPath, path.join(historyDir, paired));
          archived++;
        }
      } catch (err) {
        outputChannel.appendLine(`[HeartbeatMonitor] cleanup error for ${ackFile}: ${err}`);
      }
    }

    // Count open items
    const openFiles = entries.filter(
      (e) => e.includes('ack-blocked--') || e.includes('ack-question--'),
    );
    open = openFiles.length;
  } catch (err) {
    outputChannel.appendLine(`[HeartbeatMonitor] telegraph cleanup scan error: ${err}`);
  }

  return { archived, open };
}

/**
 * Parse YAML frontmatter from a wire file.
 * Returns { to: string | null, ... other fields }.
 */
function parseMemoFrontmatter(
  memoPath: string,
): Record<string, unknown> {
  try {
    const content = fs.readFileSync(memoPath, 'utf8');
    const result: Record<string, unknown> = {};

    if (memoPath.endsWith('.json')) {
      try {
        return JSON.parse(content) as Record<string, unknown>;
      } catch {
        return {};
      }
    }

    // Try YAML frontmatter first (--- block)
    const yamlMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (yamlMatch) {
      const lines = yamlMatch[1].split('\n');
      for (const line of lines) {
        const [key, ...valueParts] = line.split(':');
        if (key && valueParts.length > 0) {
          result[key.trim()] = valueParts.join(':').trim();
        }
      }
      return result;
    }

    // Fallback: parse Markdown bold header format (**Key:** value)
    // Handles hand-written memos like: **To:** CD(RSn)
    const mdFieldMap: Record<string, string> = {
      'To': 'to',
      'From': 'from',
      'Date': 'date',
      'Re': 'subject',
    };
    for (const [mdKey, yamlKey] of Object.entries(mdFieldMap)) {
      const mdMatch = content.match(new RegExp(`\\*\\*${mdKey}:\\*\\*\\s*(.+)`));
      if (mdMatch) {
        result[yamlKey] = mdMatch[1].trim();
      }
    }
    return result;
  } catch {
    return {};
  }
}

/**
 * Resolve a role to its scope tier.
 * Delegates to canonical roleRegistry — see src/roles/roleRegistry.ts.
 */
function resolveRoleToScope(role: string): WildWestScope | null {
  return resolveRoleToScopeFromRegistry(role);
}

/**
 * Extract role and optional pattern from 'to:' field.
 * Handles:
 *   "CD"            → { role: "CD", pattern: null }
 *   "TM(*vscode)"   → { role: "TM", pattern: "*vscode" }  (glob)
 *   "CD(wildwest-ai)" → { role: "CD", pattern: "wildwest-ai" } (exact)
 */
function normalizeToField(toField: string): { normalized: string; deprecated: boolean } {
  const match = toField.match(/^([A-Za-z]+)\(([A-Za-z0-9]+)\)(?:\.[A-Za-z]+)?$/);
  if (match) {
    const inner = match[2];
    const isLikelyIdentity = /[A-Z]/.test(inner) && !inner.includes('-') && !inner.includes('_') && !inner.includes('.');
    if (isLikelyIdentity) {
      return { normalized: match[1], deprecated: true };
    }
  }
  return { normalized: toField, deprecated: false };
}

function extractRolePattern(toField: string): { role: string; pattern: string | null } | null {
  // Bracket format (v1.1+): TM[alias] or TM(dyad)[alias] — routing anchor is in brackets
  const bracketMatch = toField.match(/^([A-Za-z]+)(?:\([^)]+\))?\[(\*?[^\]]+)\]$/);
  if (bracketMatch) return { role: bracketMatch[1], pattern: bracketMatch[2] };
  // Legacy paren format: TM(alias) or bare TM
  const parenMatch = toField.match(/^([A-Za-z]+)(?:\((\*?[^)]+)\))?$/);
  if (!parenMatch) return null;
  return { role: parenMatch[1], pattern: parenMatch[2] ?? null };
}

/**
 * List towns in a county directory.
 * Returns array of town info: { name: string; path: string; alias: string | null }
 */
function listTownsInCounty(countyPath: string): Array<{ name: string; path: string; alias: string | null }> {
  const towns: Array<{ name: string; path: string; alias: string | null }> = [];
  try {
    if (!fs.existsSync(countyPath)) return towns;
    const entries = fs.readdirSync(countyPath);
    for (const entry of entries) {
      const entryPath = path.join(countyPath, entry);
      const stat = fs.statSync(entryPath);
      if (!stat.isDirectory() || entry.startsWith('.')) continue;
      // Check if this directory has a .wildwest/registry.json (indicating it's a town)
      const regPath = path.join(entryPath, '.wildwest', 'registry.json');
      if (fs.existsSync(regPath)) {
        try {
          const reg = JSON.parse(fs.readFileSync(regPath, 'utf8')) as Record<string, unknown>;
          const alias = (reg['alias'] as string) || entry;
          towns.push({ name: entry, path: entryPath, alias });
        } catch {
          // Invalid registry, skip
        }
      }
    }
  } catch {
    // Directory read error, return empty
  }
  return towns;
}

/**
 * Resolve a town by pattern matching.
 * E.g., pattern "*vscode" matches town "wildwest-vscode"
 * Supports glob patterns: *, **, ?, [abc]
 */
/**
 * Resolve a name-or-path pattern against a list of { name, path, alias } entries.
 * If pattern starts with *, treat as glob. Otherwise, exact match against alias or name.
 */
function resolveByPattern(pattern: string, entries: Array<{ name: string; path: string; alias: string | null }>): string | null {
  if (!pattern || !entries.length) return null;
  let regex: RegExp;
  if (pattern.startsWith('*')) {
    const regexPattern = pattern
      .replace(/\./g, '\\.')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.');
    regex = new RegExp(`^${regexPattern}$`);
  } else {
    // Exact match
    regex = new RegExp(`^${pattern.replace(/\./g, '\\.')}$`);
  }
  for (const entry of entries) {
    if ((entry.alias && regex.test(entry.alias)) || regex.test(entry.name)) {
      return entry.path;
    }
  }
  return null;
}

/**
 * List counties in a territory (worldRoot/countiesDir/).
 */
function listCountiesInTerritory(worldRoot: string, countiesDir: string): Array<{ name: string; path: string; alias: string | null }> {
  const counties: Array<{ name: string; path: string; alias: string | null }> = [];
  try {
    const countiesRoot = path.join(worldRoot, countiesDir);
    if (!fs.existsSync(countiesRoot)) return counties;
    for (const entry of fs.readdirSync(countiesRoot)) {
      const entryPath = path.join(countiesRoot, entry);
      if (!fs.statSync(entryPath).isDirectory() || entry.startsWith('.')) continue;
      const regPath = path.join(entryPath, '.wildwest', 'registry.json');
      if (fs.existsSync(regPath)) {
        try {
          const reg = JSON.parse(fs.readFileSync(regPath, 'utf8')) as Record<string, unknown>;
          counties.push({ name: entry, path: entryPath, alias: (reg['alias'] as string) || null });
        } catch {
          counties.push({ name: entry, path: entryPath, alias: null });
        }
      }
    }
  } catch { /* ignore */ }
  return counties;
}

/**
 * Resolve a destination scope to its filesystem path.
 * Given current scope (town) and destination scope (county/territory),
 * constructs the path using worldRoot and countiesDir configuration.
 *
 * Examples:
 * - From town ~/wildwest/counties/wildwest-ai/wildwest-vscode/ → county ~/wildwest/counties/wildwest-ai/
 * - From town/county → territory ~/wildwest/
 * - From town → town/self → current town inbox
 * - From county → town (with pattern) ~/wildwest/counties/wildwest-ai/wildwest-framework/ (via pattern matching)
 */
function resolveScopePath(
  currentScope: WildWestScope,
  currentPath: string,
  destScope: WildWestScope,
  worldRoot: string,
  countiesDir: string,
  pattern?: string | null,
): string | null | 'AMBIGUOUS' {
  // Same scope still has an inbox. Self-addressed mail is delivered locally.
  if (currentScope === destScope) {
    return currentPath;
  }

  if (destScope === 'territory') {
    return worldRoot;
  }

  if (destScope === 'county') {
    if (currentScope === 'town') {
      // Town → parent county (no pattern needed — one parent)
      const parts = currentPath.split(path.sep);
      const countiesIdx = parts.indexOf(countiesDir);
      if (countiesIdx >= 0 && countiesIdx + 1 < parts.length) {
        return parts.slice(0, countiesIdx + 2).join(path.sep);
      }
      return null;
    }
    if (currentScope === 'territory') {
      // Territory → county: requires county pattern (multiple counties exist)
      if (!pattern) return 'AMBIGUOUS';
      const counties = listCountiesInTerritory(worldRoot, countiesDir);
      return resolveByPattern(pattern, counties);
    }
    return null;
  }

  if (destScope === 'town') {
    // Town roles (M, TM, DM, HG) require a pattern — multiple towns exist
    if (!pattern) return 'AMBIGUOUS';
    let countyPath: string | null = null;
    const parts = currentPath.split(path.sep);
    const countiesIdx = parts.indexOf(countiesDir);
    if (currentScope === 'town') {
      if (countiesIdx >= 0 && countiesIdx + 1 < parts.length) {
        countyPath = parts.slice(0, countiesIdx + 2).join(path.sep);
      }
    } else if (currentScope === 'county') {
      countyPath = currentPath;
    }
    // territory→town not supported (county must be specified first)
    if (!countyPath) return null;
    const towns = listTownsInCounty(countyPath);
    return resolveByPattern(pattern, towns);
  }

  return null;
}

/**
 * Mark a wire as permanently failed by:
 * 1. Injecting (!) into the 'to:' field so the problem is self-documenting
 * 2. Renaming the file with a '!' prefix so it's skipped on future beats
 */
function markMemoFailed(
  outboxDir: string,
  memoFile: string,
  memoPath: string,
  reason: string,
  outputChannel: vscode.OutputChannel,
): void {
  try {
    let content = fs.readFileSync(memoPath, 'utf8');

    if (memoFile.endsWith('.json')) {
      try {
        const json = JSON.parse(content) as Record<string, unknown>;
        if (typeof json['to'] === 'string') {
          json['to'] = `${json['to']}(!)`;
        }
        content = JSON.stringify(json, null, 2);
      } catch {
        // Fall back to raw content if JSON is invalid.
      }
    } else {
      // Inject (!) into YAML to: field
      content = content.replace(/^(to:\s*)(\S[^\n]*)$/m, '$1$2(!)');
      // Inject (!) into Markdown **To:** field (if no YAML)
      content = content.replace(/^(\*\*To:\*\*\s*)(\S[^\n]*)$/m, '$1$2(!)');
    }

    const failedPath = path.join(outboxDir, `!${memoFile}`);
    fs.writeFileSync(failedPath, content, 'utf8');
    fs.unlinkSync(memoPath);
    outputChannel.appendLine(
      `[HeartbeatMonitor] delivery FAILED: ${memoFile} → renamed to !${memoFile} (${reason})`,
    );
  } catch (err) {
    outputChannel.appendLine(`[HeartbeatMonitor] markMemoFailed error for ${memoFile}: ${err}`);
  }
}

/**
 * Deliver pending wires from outbox/ to remote inboxes.
 * Called on every heartbeat tick.
 *
 * Algorithm:
 * 1. Scan outbox/ for wires
 * 2. For each wire: parse 'to:' field
 * 3. Extract role and optional town pattern
 * 4. Resolve destination scope (role → scope → path, with pattern for towns)
 * 5. Write delivered copy to destination inbox/
 * 6. Stamp delivered_at in original
 * 7. Archive original to outbox/history/
 * 
 * Supported formats:
 * - JSON wires only (schema v2) using `to`/`from` fields and role-based addressing.
 * - Old markdown wire format is legacy and is no longer delivered by heartbeat.
 */
function deliverPendingOutbox(
  rootPath: string,
  scope: WildWestScope,
  outputChannel: vscode.OutputChannel,
  worldRoot: string,
  countiesDir: string,
): { delivered: number; failed: number } {
  let delivered = 0;
  let failed = 0;

  try {
    const outboxDir = path.join(rootPath, '.wildwest', 'telegraph', 'outbox');
    if (!fs.existsSync(outboxDir)) {
      return { delivered, failed };
    }

    const entries = fs.readdirSync(outboxDir);
    // Process .md/.json files — exclude hidden, ! (failed), and history/
    const memoFiles = entries.filter(
      (e) => (e.endsWith('.md') || e.endsWith('.json')) && !e.startsWith('.') && !e.startsWith('!'),
    );

    outputChannel.appendLine(
      `[HeartbeatMonitor] deliverPendingOutbox root=${rootPath} scope=${scope} outboxDir=${outboxDir} files=${memoFiles.length}`,
    );

    for (const memoFile of memoFiles) {
      try {
        const memoPath = path.join(outboxDir, memoFile);
        const frontmatter = parseMemoFrontmatter(memoPath);
        const toField = frontmatter['to'] as string | undefined;
        const fromField = (frontmatter['from'] as string | undefined) ?? '';
        outputChannel.appendLine(
          `[HeartbeatMonitor] processing memo=${memoFile} from=${fromField || '<none>'} to=${toField || '<none>'} scope=${scope}`,
        );

        // Warn if from: is bare role with no town specifier in multi-town county
        if (scope === 'county' && /^TM$/i.test(fromField.trim())) {
          const towns = listTownsInCounty(rootPath);
          if (towns.length > 1) {
            outputChannel.appendLine(
              `[HeartbeatMonitor] WARNING: ${memoFile} — 'from: TM' is ambiguous in ` +
              `multi-town county (${towns.length} towns). Use 'from: TM(alias)'.`,
            );
          }
        }

        if (!toField) {
          markMemoFailed(outboxDir, memoFile, memoPath, `missing 'to:' field`, outputChannel);
          failed++;
          continue;
        }

        const normalized = normalizeToField(toField);
        const normalizedToField = normalized.normalized;
        if (normalized.deprecated) {
          outputChannel.appendLine(
            `[HeartbeatMonitor] delivery: ${memoFile} — old/identity format '${toField}' normalized to '${normalizedToField}' (deprecated in v0.18.0, will break in v0.19.0). Use role-only format.`,
          );
        }

        // Extract role and optional pattern
        const rolePattern = extractRolePattern(normalizedToField);
        if (!rolePattern) {
          markMemoFailed(outboxDir, memoFile, memoPath, `invalid addressing format: '${normalizedToField}'`, outputChannel);
          failed++;
          continue;
        }

        const { role, pattern } = rolePattern;
        outputChannel.appendLine(
          `[HeartbeatMonitor] ${memoFile} role=${role} pattern=${pattern ?? '<none>'}`,
        );

        const destScope = resolveRoleToScope(role);
        if (!destScope) {
          markMemoFailed(outboxDir, memoFile, memoPath, `unknown role: '${role}'`, outputChannel);
          failed++;
          continue;
        }

        const destPath = resolveScopePath(scope, rootPath, destScope, worldRoot, countiesDir, pattern);
        outputChannel.appendLine(
          `[HeartbeatMonitor] ${memoFile} destScope=${destScope} destPath=${destPath === 'AMBIGUOUS' ? 'AMBIGUOUS' : destPath || '<none>'}`,
        );

        if (destPath === 'AMBIGUOUS') {
          const hint = destScope === 'town'
            ? `Use ${role}(*<town-pattern>) to specify a town`
            : `Use ${role}(<county-name>) to specify a county`;
          markMemoFailed(outboxDir, memoFile, memoPath, `ambiguous recipient — ${hint}`, outputChannel);
          failed++;
          continue;
        }

        if (!destPath) {
          markMemoFailed(outboxDir, memoFile, memoPath, `unresolvable recipient: '${normalizedToField}'`, outputChannel);
          failed++;
          continue;
        } else {
          // Deliver to destination inbox. The destination may be local for self-addressed mail.
          const destInboxDir = path.join(destPath, '.wildwest', 'telegraph', 'inbox');
          if (!fs.existsSync(destInboxDir)) {
            fs.mkdirSync(destInboxDir, { recursive: true });
          }

          // Fix 1: resolve wildcard pattern in filename to actual destination alias
          let deliveredFilename = memoFile;
          if (pattern) {
            const destAlias = readRegistryAlias(destPath);
            if (destAlias) {
              // Replace role(*pattern) with role(alias) in the filename
              const escapedPattern = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
              deliveredFilename = memoFile.replace(
                new RegExp(`${role}\\(${escapedPattern}\\)`),
                `${role}(${destAlias})`,
              );
            }
          }

          const destMemoPath = path.join(destInboxDir, deliveredFilename);

          // Copy original (without delivered_at) to destination
          const originalContent = fs.readFileSync(memoPath, 'utf8');
          fs.writeFileSync(destMemoPath, originalContent, 'utf8');

          outputChannel.appendLine(
            `[HeartbeatMonitor] delivery: ${memoFile} → ${destPath}/.wildwest/telegraph/inbox/${deliveredFilename}`,
          );

          // Update territory SSOT: wire arrived at recipient → status 'received'
          updateDestinationFlatWire(destPath, destMemoPath, deliveredFilename, outputChannel, worldRoot);
        }

        // Stamp sent_at in our copy (operator dispatched)
        let content = fs.readFileSync(memoPath, 'utf8');
        const now = new Date().toISOString();
        if (memoFile.endsWith('.json')) {
          try {
            const json = JSON.parse(content) as Record<string, unknown>;
            json['sent_at'] = now;
            json['status'] = 'sent';
            content = JSON.stringify(json, null, 2);
          } catch {
            // If JSON parse fails, leave the content unchanged.
          }
        } else {
          const deliveredLine = `delivered_at: ${now}\n`;
          // Insert delivered_at after the opening ---
          const frontmatterMatch = content.match(/^(---\n)/);
          if (frontmatterMatch) {
            content =
              frontmatterMatch[1] +
              deliveredLine +
              content.substring(frontmatterMatch[1].length);
          }
        }

        // Update the flat/ SSOT wire status so UI panels reflect the delivered result.
        updateFlatWireDeliveryStatus(worldRoot, memoPath, memoFile, outputChannel);

        // Move to outbox/history/
        const historyDir = path.join(outboxDir, 'history');
        if (!fs.existsSync(historyDir)) {
          fs.mkdirSync(historyDir, { recursive: true });
        }
        const historyPath = path.join(historyDir, memoFile);
        fs.writeFileSync(historyPath, content, 'utf8');
        fs.unlinkSync(memoPath);

        delivered++;
      } catch (err) {
        outputChannel.appendLine(
          `[HeartbeatMonitor] delivery error for ${memoFile}: ${err}`,
        );
        failed++;
      }
    }
  } catch (err) {
    outputChannel.appendLine(
      `[HeartbeatMonitor] outbox scan error: ${err}`,
    );
  }

  if (delivered > 0 || failed > 0) {
    outputChannel.appendLine(
      `[HeartbeatMonitor] outbox delivery: ${delivered} delivered, ${failed} failed`,
    );
  }

  return { delivered, failed };
}

function isActionableWireFile(filename: string): boolean {
  return (
    (filename.endsWith('.md') || filename.endsWith('.json')) &&
    !filename.startsWith('.') &&
    filename !== '.gitkeep' &&
    !filename.includes('-heartbeat--')
  );
}

function hasActionableTelegraphFiles(telegraphDir: string): boolean {
  try {
    if (!fs.existsSync(telegraphDir)) return false;

    const rootEntries = fs.readdirSync(telegraphDir);
    const hasLegacyRootWire = rootEntries.some((e) =>
      e !== 'history' &&
      e !== 'inbox' &&
      e !== 'outbox' &&
      isActionableWireFile(e)
    );
    if (hasLegacyRootWire) return true;

    const inboxDir = path.join(telegraphDir, 'inbox');
    if (fs.existsSync(inboxDir)) {
      const hasInboxWire = fs.readdirSync(inboxDir).some((e) => isActionableWireFile(e));
      if (hasInboxWire) return true;
    }

    const outboxDir = path.join(telegraphDir, 'outbox');
    if (fs.existsSync(outboxDir)) {
      const hasFailedOutboxWire = fs.readdirSync(outboxDir).some((e) =>
        e.startsWith('!') && (e.endsWith('.md') || e.endsWith('.json'))
      );
      if (hasFailedOutboxWire) return true;
    }
  } catch {
    return false;
  }
  return false;
}

function beatTown(
  rootPath: string,
  outputChannel: vscode.OutputChannel,
  worldRoot: string,
  countiesDir: string,
): HeartbeatState {
  const telegraphDir = path.join(rootPath, '.wildwest', 'telegraph');
  const sentinel = sentinelPath(rootPath, 'town');

  writeSentinel(sentinel, outputChannel);

  // Run telegraph delivery operator
  const scope = scopeOf(rootPath);
  if (scope === 'town') {
    const townDelivery = deliverPendingOutbox(rootPath, scope, outputChannel, worldRoot, countiesDir);
    let refreshNeeded = townDelivery.delivered > 0;

    // Also deliver county outbox if we can find the county root
    const countyRoot = findCountyRoot(rootPath);
    outputChannel.appendLine(`[HeartbeatMonitor] town beat countyRoot=${countyRoot ?? '<none>'}`);
    if (countyRoot) {
      const countyDelivery = deliverPendingOutbox(countyRoot, 'county', outputChannel, worldRoot, countiesDir);
      refreshNeeded = refreshNeeded || countyDelivery.delivered > 0;
    }

    if (refreshNeeded) {
      void Promise.resolve(vscode.commands.executeCommand('wildwest.refreshTelegraphPanel')).catch(() => undefined);
    }
  }

  // Run telegraph cleanup
  const cleanupResult = cleanupTelegraph(telegraphDir, outputChannel);
  if (cleanupResult.archived > 0 || cleanupResult.open > 0) {
    outputChannel.appendLine(
      `[heartbeat] telegraph cleanup: ${cleanupResult.archived} archived, ${cleanupResult.open} open`,
    );
  }

  // Validate declared identity role against scope and roster
  const scopeCheck = scopeOf(rootPath);
  if (scopeCheck === 'town') {
    const identitySetting = vscode.workspace.getConfiguration('wildwest').get<string>('identity', '');
    if (identitySetting) {
      const roleMatch = identitySetting.match(/^([A-Za-z]+)/);
      const dyadMatch = identitySetting.match(/\(([^)]+)\)/);
      if (roleMatch) {
        const role = roleMatch[1];
        if (!isValidRoleForScope(role, 'town')) {
          outputChannel.appendLine(`[HeartbeatMonitor] WARNING: Identity role "${role}" is not valid for scope "town". Valid roles: ${SCOPE_ROLES['town'].join(', ')}`);
        }
        // Roster check: warn if identity not declared in identities array (when non-empty)
        if (dyadMatch) {
          const dyad = dyadMatch[1];
          const reg = readMigratedRegistry(rootPath);
          if (reg) {
            const identities = reg['identities'] as Array<{ role?: string; dyad?: string }> | undefined;
            if (Array.isArray(identities) && identities.length > 0) {
              const inRoster = identities.some(i => i.role === role && i.dyad === dyad);
              if (!inRoster) {
                outputChannel.appendLine(
                  `[HeartbeatMonitor] WARNING: Identity "${identitySetting}" is not in the town identities roster. ` +
                  `Declared: ${identities.map(i => `${i.role}(${i.dyad})`).join(', ')}`,
                );
              }
            }
          }
        }
      }
    }
  }

  return hasActionableTelegraphFiles(telegraphDir) ? 'flagged' : 'alive';
}

function beatCounty(
  rootPath: string,
  outputChannel: vscode.OutputChannel,
  worldRoot: string,
  countiesDir: string,
): HeartbeatState {
  const sentinel = sentinelPath(rootPath, 'county');
  writeSentinel(sentinel, outputChannel);

  // Check schema version
  const reg = readRegistry(rootPath);
  const registryPath = path.join(rootPath, '.wildwest', 'registry.json');
  if (reg) {
    const schemaVersion = reg['schema_version'] as string | undefined;
    if (!schemaVersion || schemaVersion === '1') {
      outputChannel.appendLine(
        `[wildwest] WARNING: Registry at ${registryPath} is schema v1 (has 'path' fields). ` +
        `Update to schema v2: remove 'path' fields, add "schema_version": "2", rename 'name' → 'alias' in county entries.`
      );
    }
  }

  // Check all towns listed in registry are present on disk
  let ok = true;
  if (reg) {
    const countyAlias = reg['alias'] as string | undefined;
    const towns = reg['towns'] as Array<{ alias?: string }> | undefined;
    if (Array.isArray(towns) && countyAlias) {
      for (const t of towns) {
        const townAlias = t.alias;
        if (townAlias) {
          const tp = path.join(worldRoot, countiesDir, countyAlias, townAlias);
          if (!fs.existsSync(path.join(tp, '.wildwest', 'registry.json'))) {
            outputChannel.appendLine(`[HeartbeatMonitor] county: town missing on disk: ${tp}`);
            ok = false;
          }
        }
      }
    }
  }

  // Process county and town outboxes when a county scope is active.
  let refreshNeeded = false;
  const countyDelivery = deliverPendingOutbox(rootPath, 'county', outputChannel, worldRoot, countiesDir);
  refreshNeeded = refreshNeeded || countyDelivery.delivered > 0;
  const towns = listTownsInCounty(rootPath);
  for (const townInfo of towns) {
    const townDelivery = deliverPendingOutbox(townInfo.path, 'town', outputChannel, worldRoot, countiesDir);
    refreshNeeded = refreshNeeded || townDelivery.delivered > 0;
  }

  if (refreshNeeded) {
    void Promise.resolve(vscode.commands.executeCommand('wildwest.refreshTelegraphPanel')).catch(() => undefined);
  }

  return ok ? 'alive' : 'flagged';
}

function beatTerritory(
  rootPath: string,
  outputChannel: vscode.OutputChannel,
  worldRoot: string,
  countiesDir: string,
): HeartbeatState {
  const sentinel = sentinelPath(rootPath, 'territory');
  writeSentinel(sentinel, outputChannel);

  // Check schema version
  const reg = readRegistry(rootPath);
  const registryPath = path.join(rootPath, '.wildwest', 'registry.json');
  if (reg) {
    const schemaVersion = reg['schema_version'] as string | undefined;
    if (!schemaVersion || schemaVersion === '1') {
      outputChannel.appendLine(
        `[wildwest] WARNING: Registry at ${registryPath} is schema v1 (has 'path' fields). ` +
        `Update to schema v2: remove 'path' fields, add "schema_version": "2", use 'alias' instead of 'name' in county entries.`
      );
    }
  }

  // Check all counties listed in registry are present on disk
  let ok = true;
  if (reg) {
    const counties = reg['counties'] as Array<{ alias?: string }> | undefined;
    if (Array.isArray(counties)) {
      for (const c of counties) {
        const countyAlias = c.alias;
        if (countyAlias) {
          const cp = path.join(worldRoot, countiesDir, countyAlias);
          if (!fs.existsSync(path.join(cp, '.wildwest', 'registry.json'))) {
            outputChannel.appendLine(`[HeartbeatMonitor] territory: county missing on disk: ${cp}`);
            ok = false;
          }
        }
      }
    }
  }
  return ok ? 'alive' : 'flagged';
}

// ---------------------------------------------------------------------------
// HeartbeatMonitor
// ---------------------------------------------------------------------------

export class HeartbeatMonitor {
  private scopes: ScopeRoot[] = [];
  private scopeStates: Map<string, HeartbeatState> = new Map();
  private outputChannel: vscode.OutputChannel;
  private worldRoot: string;
  private countiesDir: string;

  constructor(outputChannel: vscode.OutputChannel, worldRoot: string, countiesDir: string) {
    this.outputChannel = outputChannel;
    this.worldRoot = worldRoot;
    this.countiesDir = countiesDir;
  }

  start(): void {
    if (this.scopes.some((s) => s.timer !== null)) return;

    this.scopes = this.detectScopes();
    if (this.scopes.length === 0) {
      this.outputChannel.appendLine('[HeartbeatMonitor] no governed scopes found — not starting');
      return;
    }

    for (const scope of this.scopes) {
      this.startScopeTimer(scope);
    }
  }

  stop(): void {
    for (const scope of this.scopes) {
      if (scope.timer) {
        clearInterval(scope.timer);
        scope.timer = null;
      }
      this.scopeStates.set(scope.rootPath, 'stopped');
    }
    this.outputChannel.appendLine('[HeartbeatMonitor] stopped all scope timers');
  }

  isRunning(): boolean {
    return this.scopes.some((s) => s.timer !== null);
  }

  checkLiveness(): HeartbeatState {
    // Report liveness for the highest-priority scope present in this workspace.
    // Town > county > territory — fall through until we find one.
    const primary = this.scopes.find((s) => s.scope === 'town')
      ?? this.scopes.find((s) => s.scope === 'county')
      ?? this.scopes.find((s) => s.scope === 'territory');
    if (!primary) return 'stopped';
    const sentinel = sentinelPath(primary.rootPath, primary.scope);
    try {
      const stat = fs.statSync(sentinel);
      const staleMs = STALE_MULTIPLIER * effectiveIntervalMs(primary.rootPath, primary.scope);
      const ageMs = Date.now() - stat.mtimeMs;
      if (ageMs >= staleMs) return 'stopped';
      return this.scopeStates.get(primary.rootPath) ?? 'stopped';
    } catch {
      return 'stopped';
    }
  }

  setFlagged(flagged: boolean): void {
    const town = this.scopes.find((s) => s.scope === 'town');
    if (!town) return;
    const current = this.scopeStates.get(town.rootPath);
    if (current === 'stopped') return;
    this.scopeStates.set(town.rootPath, flagged ? 'flagged' : 'alive');
  }

  /**
   * Trigger immediate outbox delivery for the town scope.
   * Called by TelegraphWatcher when a new outbox memo is detected,
   * so delivery happens immediately rather than waiting for the next beat.
   */
  deliverOutboxNow(): void {
    const town = this.scopes.find((s) => s.scope === 'town');
    if (town) {
      this.outputChannel.appendLine('[HeartbeatMonitor] outbox delivery triggered by new memo');
      const townDelivery = deliverPendingOutbox(town.rootPath, town.scope, this.outputChannel, this.worldRoot, this.countiesDir);
      let refreshNeeded = townDelivery.delivered > 0;
      const countyRoot = findCountyRoot(town.rootPath);
      this.outputChannel.appendLine(`[HeartbeatMonitor] deliverOutboxNow town=${town.rootPath} countyRoot=${countyRoot ?? '<none>'}`);
      if (countyRoot) {
        const countyDelivery = deliverPendingOutbox(countyRoot, 'county', this.outputChannel, this.worldRoot, this.countiesDir);
        refreshNeeded = refreshNeeded || countyDelivery.delivered > 0;
      }
      if (refreshNeeded) {
        void Promise.resolve(vscode.commands.executeCommand('wildwest.refreshTelegraphPanel')).catch(() => undefined);
      }
      return;
    }

    const county = this.scopes.find((s) => s.scope === 'county');
    if (county) {
      this.outputChannel.appendLine('[HeartbeatMonitor] outbox delivery triggered by new memo in county scope');
      deliverPendingOutbox(county.rootPath, county.scope, this.outputChannel, this.worldRoot, this.countiesDir);
      const towns = listTownsInCounty(county.rootPath);
      for (const townInfo of towns) {
        deliverPendingOutbox(townInfo.path, 'town', this.outputChannel, this.worldRoot, this.countiesDir);
      }
    }
  }

  dispose(): void {
    this.stop();
  }

  /**
   * Detect the scope of the current workspace (primary folder).
   * Checks the primary folder first, then walks up to find any Wild West scope.
   * Returns the scope from registry.json or null if not found.
   */
  detectScope(): WildWestScope | null {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) return null;
    const primaryFolder = folders[0].uri.fsPath;
    
    // Check primary folder first
    const primaryScope = scopeOf(primaryFolder);
    if (primaryScope) return primaryScope;
    
    // Walk up to find any Wild West scope (town, county, or territory)
    let current = primaryFolder;
    const root = path.parse(current).root;
    while (current !== root) {
      current = path.dirname(current);
      const s = scopeOf(current);
      if (s) return s; // Return any scope found
    }
    
    return null;
  }

  /**
   * Validate that the declared identity role is valid for the given scope.
   * Extracts role from identity setting (e.g. "TM" from "TM(RHk)").
   * Returns true if valid or no identity declared; false if invalid role for scope.
   */
  validateIdentityForScope(identity: string, scope: WildWestScope): boolean {
    if (!identity) return true; // Empty identity is valid (no declaration)
    const roleMatch = identity.match(/^([A-Za-z]+)/);
    if (!roleMatch) return false; // Malformed identity
    const role = roleMatch[1];
    return isValidRoleForScope(role, scope);
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  /**
   * Detect all governed scope roots from workspace folders.
   * For each town found, walk upward to find its county and territory roots.
   * Deduplicates by rootPath.
   */
  private detectScopes(): ScopeRoot[] {
    const folders = vscode.workspace.workspaceFolders ?? [];
    const seen = new Set<string>();
    const result: ScopeRoot[] = [];

    const add = (rootPath: string, scope: WildWestScope) => {
      if (seen.has(rootPath)) return;
      seen.add(rootPath);
      result.push({ scope, rootPath, timer: null });
    };

    for (const f of folders) {
      const fp = f.uri.fsPath;
      const s = scopeOf(fp);
      if (s) {
        add(fp, s);
      } else if (fs.existsSync(path.join(fp, '.wildwest', 'registry.json'))) {
        // fallback: registry.json exists but scopeOf() returned null (malformed registry)
        add(fp, 'town');
      }
    }

    // For each town, walk up to find county + territory
    for (const sr of [...result]) {
      if (sr.scope !== 'town') continue;
      const countyPath = walkUpForScope(sr.rootPath, 'county');
      if (countyPath) add(countyPath, 'county');
      const worldPath = walkUpForScope(sr.rootPath, 'territory');
      if (worldPath) add(worldPath, 'territory');
    }

    return result;
  }

  private startScopeTimer(scope: ScopeRoot): void {
    const intervalMs = effectiveIntervalMs(scope.rootPath, scope.scope);
    // Fire immediately, then on interval
    this.beatScope(scope);
    scope.timer = setInterval(() => {
      // Re-read interval on each beat — active state may have changed
      const newInterval = effectiveIntervalMs(scope.rootPath, scope.scope);
      if (scope.timer && newInterval !== intervalMs) {
        clearInterval(scope.timer);
        scope.timer = setInterval(() => this.beatScope(scope), newInterval);
      }
      this.beatScope(scope);
    }, intervalMs);
    this.outputChannel.appendLine(
      `[HeartbeatMonitor] ${scope.scope} scope started — root=${scope.rootPath} interval=${intervalMs}ms`,
    );
  }

  private beatScope(scope: ScopeRoot): void {
    let state: HeartbeatState;
    try {
      switch (scope.scope) {
        case 'town':
          state = beatTown(scope.rootPath, this.outputChannel, this.worldRoot, this.countiesDir);
          break;
        case 'county':
          state = beatCounty(scope.rootPath, this.outputChannel, this.worldRoot, this.countiesDir);
          break;
        case 'territory':
          state = beatTerritory(scope.rootPath, this.outputChannel, this.worldRoot, this.countiesDir);
          break;
      }
    } catch (err) {
      this.outputChannel.appendLine(`[HeartbeatMonitor] beat error (${scope.scope}): ${err}`);
      state = 'stopped';
    }
    this.scopeStates.set(scope.rootPath, state);
    this.outputChannel.appendLine(`[HeartbeatMonitor] beat — scope=${scope.scope} state=${state}`);
  }

}

export const __test__ = {
  deliverPendingOutbox,
  beatTown,
};
