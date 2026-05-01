import { exec } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { WorktreeManager } from './WorktreeManager';

// Absolute hardcoded floor — 5 min.
// Used when no registry.json and no VS Code setting overrides for a scope.
const FLOOR_MS = 300_000;

// Staleness threshold for .last-beat sentinel: 2× the scope's idle interval.
// Computed per scope at runtime.
const STALE_MULTIPLIER = 2;

export type HeartbeatState = 'alive' | 'flagged' | 'stopped';
export type WildWestScope = 'town' | 'county' | 'world';

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

function scopeOf(rootPath: string): WildWestScope | null {
  const reg = readRegistry(rootPath);
  if (!reg) return null;
  const s = reg['scope'];
  if (s === 'town' || s === 'county' || s === 'world') return s;
  return null;
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

function beatTown(
  rootPath: string,
  outputChannel: vscode.OutputChannel,
): HeartbeatState {
  const telegraphDir = path.join(rootPath, '.wildwest', 'telegraph');
  const sentinel = sentinelPath(rootPath, 'town');

  writeSentinel(sentinel, outputChannel);

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
): HeartbeatState {
  const sentinel = sentinelPath(rootPath, 'county');
  writeSentinel(sentinel, outputChannel);

  // Check all towns listed in registry are present on disk
  const reg = readRegistry(rootPath);
  let ok = true;
  if (reg) {
    const towns = reg['towns'] as Array<{ path?: string }> | undefined;
    if (Array.isArray(towns)) {
      for (const t of towns) {
        const tp = t.path ? t.path.replace(/^~/, process.env['HOME'] ?? '~') : null;
        if (tp && !fs.existsSync(path.join(tp, '.wildwest', 'registry.json'))) {
          outputChannel.appendLine(`[HeartbeatMonitor] county: town missing on disk: ${tp}`);
          ok = false;
        }
      }
    }
  }
  return ok ? 'alive' : 'flagged';
}

function beatWorld(
  rootPath: string,
  outputChannel: vscode.OutputChannel,
): HeartbeatState {
  const sentinel = sentinelPath(rootPath, 'world');
  writeSentinel(sentinel, outputChannel);

  // Check all counties listed in registry are present on disk
  const reg = readRegistry(rootPath);
  let ok = true;
  if (reg) {
    const counties = reg['counties'] as Array<{ path?: string }> | undefined;
    if (Array.isArray(counties)) {
      for (const c of counties) {
        const cp = c.path ? c.path.replace(/^~/, process.env['HOME'] ?? '~') : null;
        if (cp && !fs.existsSync(path.join(cp, '.wildwest', 'registry.json'))) {
          outputChannel.appendLine(`[HeartbeatMonitor] world: county missing on disk: ${cp}`);
          ok = false;
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
  private statusBarItem: vscode.StatusBarItem;
  private outputChannel: vscode.OutputChannel;
  private worktreeManager: WorktreeManager;
  private govCache: { branch: string; worktreeCount: number } = { branch: '?', worktreeCount: 0 };

  constructor(outputChannel: vscode.OutputChannel, worktreeManager: WorktreeManager) {
    this.outputChannel = outputChannel;
    this.worktreeManager = worktreeManager;
    this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.statusBarItem.command = 'wildwest.viewTelegraph';
    this.statusBarItem.show();
    this.updateStatusBar();
    this.refreshGovCache();
  }

  start(): void {
    if (this.scopes.some((s) => s.timer !== null)) return;

    this.scopes = this.detectScopes();
    if (this.scopes.length === 0) {
      this.outputChannel.appendLine('[HeartbeatMonitor] no governed scopes found — not starting');
      this.updateStatusBar();
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
    this.updateStatusBar();
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
    this.updateStatusBar();
  }

  dispose(): void {
    this.stop();
    this.statusBarItem.dispose();
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  /**
   * Detect all governed scope roots from workspace folders.
   * For each town found, walk upward to find its county and world roots.
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
      } else if (fs.existsSync(path.join(fp, '.wildwest', 'scripts'))) {
        // pre-spec backward compat: treat as town
        add(fp, 'town');
      }
    }

    // For each town, walk up to find county + world
    for (const sr of [...result]) {
      if (sr.scope !== 'town') continue;
      const countyPath = walkUpForScope(sr.rootPath, 'county');
      if (countyPath) add(countyPath, 'county');
      const worldPath = walkUpForScope(sr.rootPath, 'world');
      if (worldPath) add(worldPath, 'world');
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
          state = beatCounty(scope.rootPath, this.outputChannel);
          break;
        case 'world':
          state = beatWorld(scope.rootPath, this.outputChannel);
          break;
      }
    } catch (err) {
      this.outputChannel.appendLine(`[HeartbeatMonitor] beat error (${scope.scope}): ${err}`);
      state = 'stopped';
    }
    this.scopeStates.set(scope.rootPath, state);
    this.outputChannel.appendLine(`[HeartbeatMonitor] beat — scope=${scope.scope} state=${state}`);
    this.refreshGovCache();
  }

  /** Returns the town root if one is detected — used for branch/worktree display. */
  private getTownRoot(): string | null {
    return this.scopes.find((s) => s.scope === 'town')?.rootPath ?? null;
  }

  private refreshGovCache(): void {
    const cwd = this.getTownRoot();

    const updateWorktreeCount = () => {
      const worktrees = this.worktreeManager.list();
      this.govCache.worktreeCount = worktrees.filter((w) => !w.isHeartbeat && !w.isMain).length;
      this.updateStatusBar();
    };

    if (cwd) {
      exec('git rev-parse --abbrev-ref HEAD', { cwd, encoding: 'utf8' }, (err, stdout) => {
        if (!err) {
          this.govCache.branch = stdout.trim();
        }
        updateWorktreeCount();
      });
    } else {
      updateWorktreeCount();
    }
  }

  private getGovInfo(): { branch: string; tier: number; worktreeCount: number } {
    const { branch, worktreeCount } = this.govCache;
    const cwd = this.getTownRoot();

    let tier = 4;
    if (cwd) {
      const townState = this.scopeStates.get(cwd);
      if (townState && townState !== 'stopped') {
        const hasBranchDoc = fs.existsSync(
          path.join(cwd, '.wildwest', 'board', 'branches', 'active', branch, 'README.md'),
        );
        tier = hasBranchDoc ? 2 : 1;
      }
    }

    return { branch, tier, worktreeCount };
  }

  private updateStatusBar(): void {
    const { branch, tier, worktreeCount } = this.getGovInfo();
    const wtLabel = worktreeCount === 1 ? '1 wt' : `${worktreeCount} wt`;
    // Overall state for status bar = town state (primary) or worst-scope state if no town
    const displayState = this.checkLiveness();

    switch (displayState) {
      case 'alive':
        this.statusBarItem.text = `● Wild West  $(git-branch) ${branch}  T${tier}  ${wtLabel}`;
        this.statusBarItem.tooltip = `Heartbeat alive — no flags\nBranch: ${branch}  |  Solo Tier ${tier}  |  ${wtLabel}`;
        this.statusBarItem.color = undefined;
        break;
      case 'flagged':
        this.statusBarItem.text = `⚠ Wild West  $(git-branch) ${branch}  T${tier}  ${wtLabel}`;
        this.statusBarItem.tooltip = `Heartbeat alive — flags present (click to view telegraph)\nBranch: ${branch}  |  Solo Tier ${tier}  |  ${wtLabel}`;
        this.statusBarItem.color = new vscode.ThemeColor('statusBarItem.warningForeground');
        break;
      case 'stopped':
        this.statusBarItem.text = `○ Wild West  $(git-branch) ${branch}  T4  ${wtLabel}`;
        this.statusBarItem.tooltip = `Heartbeat stopped or stale — no governed scope detected?\nBranch: ${branch}  |  Solo Tier 4 (no heartbeat)  |  ${wtLabel}`;
        this.statusBarItem.color = new vscode.ThemeColor('statusBarItem.errorForeground');
        break;
    }
  }
}
