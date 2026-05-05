import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

// Absolute hardcoded floor — 5 min.
// Used when no registry.json and no VS Code setting overrides for a scope.
const FLOOR_MS = 300_000;

// Staleness threshold for .last-beat sentinel: 2× the scope's idle interval.
// Computed per scope at runtime.
const STALE_MULTIPLIER = 2;

export type HeartbeatState = 'alive' | 'flagged' | 'stopped';
export type WildWestScope = 'town' | 'county' | 'territory';

// Approved scope → roles mapping per CD decision
const SCOPE_ROLES: Record<WildWestScope, string[]> = {
  'territory': ['G', 'RA'],
  'county': ['S', 'CD', 'TM'],
  'town': ['Mayor', 'TM', 'HG'],
};

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

function scopeOf(rootPath: string): WildWestScope | null {
  let reg = readRegistry(rootPath);
  if (!reg) return null;

  // Auto-migrate if schema_version is missing
  if (!reg['schema_version']) {
    reg = migrateRegistry(rootPath, reg);
  }

  const s = reg['scope'];
  if (s === 'town' || s === 'county' || s === 'territory') return s;
  return null;
}

/**
 * Validate if an actor role is valid for a given scope.
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
 * Scan telegraphDir for resolved memo pairs (ack-done/ack-deferred + original).
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

function beatTown(
  rootPath: string,
  outputChannel: vscode.OutputChannel,
): HeartbeatState {
  const telegraphDir = path.join(rootPath, '.wildwest', 'telegraph');
  const sentinel = sentinelPath(rootPath, 'town');

  writeSentinel(sentinel, outputChannel);

  // Run telegraph cleanup
  const cleanupResult = cleanupTelegraph(telegraphDir, outputChannel);
  if (cleanupResult.archived > 0 || cleanupResult.open > 0) {
    outputChannel.appendLine(
      `[heartbeat] telegraph cleanup: ${cleanupResult.archived} archived, ${cleanupResult.open} open`,
    );
  }

  // Validate declared actor role against scope
  const scope = scopeOf(rootPath);
  if (scope === 'town') {
    const actorSetting = vscode.workspace.getConfiguration('wildwest').get<string>('actor', '');
    if (actorSetting) {
      // Extract just the role part (before any parentheses, e.g. "TM" from "TM(RHk)")
      const roleMatch = actorSetting.match(/^([A-Za-z]+)/);
      if (roleMatch) {
        const role = roleMatch[1];
        if (!isValidRoleForScope(role, 'town')) {
          outputChannel.appendLine(`[HeartbeatMonitor] WARNING: Actor role "${role}" is not valid for scope "town". Valid roles: ${SCOPE_ROLES['town'].join(', ')}`);
        }
      }
    }
  }

  // Scan telegraph for non-heartbeat, non-sentinel, non-history files = flags
  let flagged = false;
  try {
    flagged = fs.readdirSync(telegraphDir).some(
      (e) => !e.startsWith('.') && e !== 'history' && !e.includes('-heartbeat--'),
    );
  } catch { /* telegraph dir may not exist yet */ }

  return flagged ? 'flagged' : 'alive';
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
    // Report town liveness for status bar (primary concern for the user)
    const town = this.scopes.find((s) => s.scope === 'town');
    if (!town) return 'stopped';
    const sentinel = sentinelPath(town.rootPath, 'town');
    try {
      const stat = fs.statSync(sentinel);
      const staleMs = STALE_MULTIPLIER * effectiveIntervalMs(town.rootPath, 'town');
      const ageMs = Date.now() - stat.mtimeMs;
      if (ageMs >= staleMs) return 'stopped';
      return this.scopeStates.get(town.rootPath) ?? 'stopped';
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
   * Validate that the declared actor role is valid for the given scope.
   * Extracts role from actor setting (e.g. "TM" from "TM(RHk)").
   * Returns true if valid or no actor declared; false if invalid role for scope.
   */
  validateActorForScope(actor: string, scope: WildWestScope): boolean {
    if (!actor) return true; // Empty actor is valid (no declaration)
    const roleMatch = actor.match(/^([A-Za-z]+)/);
    if (!roleMatch) return false; // Malformed actor
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
          state = beatTown(scope.rootPath, this.outputChannel);
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
