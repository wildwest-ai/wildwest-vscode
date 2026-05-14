/**
 * SessionMapSeeder — seeds .wildwest/session-map.json by matching AI sessions
 * to towns and counties using two signals:
 *
 *   1. TEMPORAL: session timestamp falls on a day with git commits in the town's repo.
 *   2. CONTENT:  raw session content references file paths rooted in the town's repo.
 *
 * Mapping rules (per wildwest governance):
 *   Town   = git repository  → match via `git log` + path signals
 *   County = GitHub org      → match via aggregation of child town matches
 *
 * Output: writes/updates .wildwest/session-map.json in each matched scope directory.
 * Overrides are additive — never overwrites manually-crafted entries.
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { SessionMapService, SessionMapOverride } from './SessionMapService';
import { ScopeRef, WildWestScope } from './sessionPipeline/types';

const TOOL_RAW_DIRS: Record<string, string> = {
  cpt: 'github-copilot',
  cld: 'claude-code',
  ccx: 'chatgpt-codex',
};

type SessionTool = 'cpt' | 'cld' | 'ccx';

interface RawSessionInfo {
  tool: SessionTool;
  tool_sid: string;
  rawPath: string;
  createdAt: Date | null;
}

interface RegistryRef {
  scope: WildWestScope;
  wwuid: string;
  alias: string;
  repoPath: string;
}

export interface SeedResult {
  townPath: string;
  matchedSessions: number;
  overridesWritten: number;
}

export class SessionMapSeeder {
  private rawDir: string;

  constructor(rawDir: string) {
    this.rawDir = rawDir;
  }

  /**
   * Seed session-map.json for a given workspace root (town or county).
   * - If town: runs matching for that repo, writes to town's .wildwest/session-map.json
   * - If county: iterates child towns, runs matching for each, writes to each town
   *   and to the county's .wildwest/session-map.json (county-scoped sessions)
   *
   * Returns summary of sessions matched per town.
   */
  seed(workspaceRoot: string): SeedResult[] {
    const reg = this.readRegistry(workspaceRoot);
    if (!reg) return [];

    if (reg.scope === 'town') {
      return [this.seedTown(workspaceRoot, reg, [])];
    }

    if (reg.scope === 'county') {
      return this.seedCounty(workspaceRoot, reg);
    }

    if (reg.scope === 'territory') {
      return this.seedTerritory(workspaceRoot, reg);
    }

    return [];
  }

  // ─── Town ───────────────────────────────────────────────────────────────────

  private seedTown(townPath: string, townReg: RegistryRef, ancestorRefs: RegistryRef[]): SeedResult {
    const allRawSessions = this.collectRawSessions();
    const gitDays = this.getGitActiveDays(townPath);
    const overrides: SessionMapOverride[] = [];

    for (const rawSession of allRawSessions) {
      const match = this.matchesScope(rawSession, townPath, gitDays);
      if (!match.matches) continue;

      // Build inject_scope_refs: town + all ancestors (county, territory)
      const injectRefs: ScopeRef[] = [
        { scope: townReg.scope, wwuid: townReg.wwuid, alias: townReg.alias, path: townPath },
        ...ancestorRefs.map((a) => ({
          scope: a.scope,
          wwuid: a.wwuid,
          alias: a.alias,
          path: a.repoPath,
        })),
      ];

      overrides.push({
        tool_sid: rawSession.tool_sid,
        tool: rawSession.tool,
        inject_scope_refs: injectRefs,
        note: `seeded: ${match.signals.join(', ')}`,
      });
    }

    if (overrides.length > 0) {
      SessionMapService.writeOverrides(townPath, overrides);
    }

    return { townPath, matchedSessions: overrides.length, overridesWritten: overrides.length };
  }

  // ─── County ─────────────────────────────────────────────────────────────────

  private seedCounty(countyPath: string, countyReg: RegistryRef): SeedResult[] {
    const results: SeedResult[] = [];

    // Collect ancestor refs above county (territory)
    const ancestorsAboveCounty = this.collectAncestorRefs(path.dirname(countyPath));

    // Process each child town
    let countyChildDirs: fs.Dirent[] = [];
    try {
      countyChildDirs = fs.readdirSync(countyPath, { withFileTypes: true });
    } catch { return results; }

    for (const entry of countyChildDirs) {
      if (!entry.isDirectory()) continue;
      const townPath = path.join(countyPath, entry.name);
      const townReg = this.readRegistry(townPath);
      if (!townReg || townReg.scope !== 'town') continue;

      const ancestorsForTown: RegistryRef[] = [
        countyReg,
        ...ancestorsAboveCounty,
      ];

      results.push(this.seedTown(townPath, townReg, ancestorsForTown));
    }

    return results;
  }

  // ─── Territory ──────────────────────────────────────────────────────────────

  private seedTerritory(territoryPath: string, _territoryReg: RegistryRef): SeedResult[] {
    const results: SeedResult[] = [];
    let countiesDirs: fs.Dirent[] = [];
    try {
      // Check if counties are in a 'counties/' subdir (standard layout)
      const countiesSubdir = path.join(territoryPath, 'counties');
      const scanRoot = fs.existsSync(countiesSubdir) ? countiesSubdir : territoryPath;
      countiesDirs = fs.readdirSync(scanRoot, { withFileTypes: true }).map((e) => {
        e.path = scanRoot; // attach for path join later
        return e;
      });
      for (const entry of countiesDirs) {
        if (!entry.isDirectory()) continue;
        const countyPath = path.join(entry.path ?? scanRoot, entry.name);
        const countyReg = this.readRegistry(countyPath);
        if (!countyReg || countyReg.scope !== 'county') continue;
        results.push(...this.seedCounty(countyPath, countyReg));
      }
    } catch { /* ignore */ }
    return results;
  }

  // ─── Matching logic ─────────────────────────────────────────────────────────

  /**
   * Returns whether a raw session matches a given scope (town) path.
   *
   * Signal 1 — TEMPORAL: session created_at date has git commits in the repo.
   * Signal 2 — CONTENT:  raw session content contains the repo path string.
   */
  private matchesScope(
    rawSession: RawSessionInfo,
    repoPath: string,
    gitDays: Set<string>,
  ): { matches: boolean; signals: string[] } {
    const signals: string[] = [];

    // Signal 1: temporal
    if (rawSession.createdAt) {
      const dayStr = rawSession.createdAt.toISOString().slice(0, 10); // YYYY-MM-DD
      if (gitDays.has(dayStr)) {
        signals.push(`git-day:${dayStr}`);
      }
    }

    // Signal 2: content — read raw file and check for repo path string
    if (fs.existsSync(rawSession.rawPath)) {
      try {
        const content = fs.readFileSync(rawSession.rawPath, 'utf8');
        // Use repo basename for faster check first, then full path
        const repoBasename = path.basename(repoPath);
        if (content.includes(repoBasename) && content.includes(repoPath)) {
          signals.push(`content-path`);
        }
      } catch { /* skip */ }
    }

    return { matches: signals.length > 0, signals };
  }

  // ─── Git helpers ────────────────────────────────────────────────────────────

  /**
   * Returns a Set of 'YYYY-MM-DD' strings for all days with commits in the repo.
   */
  private getGitActiveDays(repoPath: string): Set<string> {
    const days = new Set<string>();
    if (!fs.existsSync(path.join(repoPath, '.git'))) return days;
    try {
      // git log format: one ISO date per commit
      const out = execSync('git log --format="%ai"', {
        cwd: repoPath,
        encoding: 'utf8',
        timeout: 10000,
        stdio: ['pipe', 'pipe', 'ignore'],
      });
      for (const line of out.split('\n')) {
        const trimmed = line.trim().replace(/^"|"$/g, '');
        if (trimmed.length >= 10) {
          days.add(trimmed.slice(0, 10)); // YYYY-MM-DD
        }
      }
    } catch { /* repo may have no commits */ }
    return days;
  }

  // ─── Raw session collection ──────────────────────────────────────────────────

  private collectRawSessions(): RawSessionInfo[] {
    const sessions: RawSessionInfo[] = [];
    for (const [tool, dir] of Object.entries(TOOL_RAW_DIRS)) {
      const toolDir = path.join(this.rawDir, dir);
      if (!fs.existsSync(toolDir)) continue;
      for (const file of fs.readdirSync(toolDir)) {
        if (!file.endsWith('.json')) continue;
        const rawPath = path.join(toolDir, file);
        const tool_sid = file.replace(/\.json$/, '');
        const createdAt = this.extractCreatedAt(rawPath, tool as SessionTool);
        sessions.push({ tool: tool as SessionTool, tool_sid, rawPath, createdAt });
      }
    }
    return sessions;
  }

  private extractCreatedAt(rawPath: string, tool: SessionTool): Date | null {
    try {
      const raw = JSON.parse(fs.readFileSync(rawPath, 'utf8')) as Record<string, unknown>;
      // cpt: creationDate is epoch ms integer
      if (tool === 'cpt') {
        const ts = raw['creationDate'];
        if (typeof ts === 'number') return new Date(ts);
        if (typeof ts === 'string') return new Date(ts);
      }
      // cld: createdAt ISO string or numeric
      if (tool === 'cld') {
        const ts = raw['createdAt'] ?? raw['created_at'];
        if (typeof ts === 'number') return new Date(ts > 1e10 ? ts : ts * 1000);
        if (typeof ts === 'string') return new Date(ts);
      }
      // ccx: session_meta.timestamp or rollout date from filename
      if (tool === 'ccx') {
        const meta = raw['session_meta'] as Record<string, unknown> | undefined;
        const ts = meta?.['timestamp'];
        if (typeof ts === 'string') return new Date(ts);
      }
    } catch { /* skip */ }
    return null;
  }

  // ─── Registry helpers ────────────────────────────────────────────────────────

  private readRegistry(dir: string): RegistryRef | null {
    try {
      const regPath = path.join(dir, '.wildwest', 'registry.json');
      if (!fs.existsSync(regPath)) return null;
      const reg = JSON.parse(fs.readFileSync(regPath, 'utf8')) as Record<string, unknown>;
      const scope = reg['scope'] as WildWestScope | undefined;
      const wwuid = reg['wwuid'] as string | undefined;
      if (!scope || !wwuid || !['town', 'county', 'territory'].includes(scope)) return null;
      return {
        scope,
        wwuid,
        alias: (reg['alias'] as string) || path.basename(dir),
        repoPath: dir,
      };
    } catch { return null; }
  }

  /**
   * Collect RegistryRef for each ancestor directory (not including startDir itself).
   */
  private collectAncestorRefs(startDir: string): RegistryRef[] {
    const refs: RegistryRef[] = [];
    let current = startDir;
    const fsRoot = path.parse(current).root;
    while (current && current !== fsRoot) {
      const ref = this.readRegistry(current);
      if (ref) refs.push(ref);
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
    return refs;
  }
}
