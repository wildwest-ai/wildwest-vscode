/**
 * SessionMapService — reads .wildwest/session-map.json override files.
 *
 * session-map.json lives in each town/county directory (outside sessions/)
 * and provides additive scope_ref injections for sessions that auto-attribution
 * cannot resolve — e.g., multi-workspace CPT sessions, pre-move path sessions,
 * or sessions run from a territory root.
 *
 * Schema: .wildwest/session-map.json
 * {
 *   "schema_version": "1",
 *   "overrides": [
 *     {
 *       "tool_sid": "<copilot/claude/codex session id>",
 *       "tool": "cpt" | "cld" | "ccx",   // optional, for documentation
 *       "inject_scope_refs": [
 *         { "scope": "town", "wwuid": "...", "alias": "...", "path": "..." }
 *       ],
 *       "note": "optional human comment"
 *     }
 *   ]
 * }
 *
 * Overrides are ADDITIVE — they merge with auto-resolved scope_refs, never replace.
 * Multiple session-map.json files (one per town, county, territory in the ancestry)
 * are all loaded and merged together.
 */

import * as fs from 'fs';
import * as path from 'path';
import { ScopeRef, WildWestScope } from './sessionPipeline/types';

export interface SessionMapOverride {
  tool_sid: string;
  tool?: string;
  inject_scope_refs: ScopeRef[];
  note?: string;
}

export interface SessionMap {
  schema_version: string;
  overrides: SessionMapOverride[];
}

export class SessionMapService {
  // tool_sid → merged inject_scope_refs from all loaded maps
  private overrideMap = new Map<string, ScopeRef[]>();

  /**
   * Load session-map.json files from all provided directory paths.
   * Directories are walked in order; all overrides are merged additively.
   * @param dirs Array of directories to check for .wildwest/session-map.json
   */
  loadFromDirs(dirs: string[]): void {
    this.overrideMap.clear();
    for (const dir of dirs) {
      const mapPath = path.join(dir, '.wildwest', 'session-map.json');
      if (!fs.existsSync(mapPath)) continue;
      try {
        const raw = JSON.parse(fs.readFileSync(mapPath, 'utf8')) as SessionMap;
        for (const override of (raw.overrides ?? [])) {
          if (!override.tool_sid) continue;
          const injectRefs = (override.inject_scope_refs ?? []).filter(
            (ref) => ref.scope && ref.wwuid
          );
          if (injectRefs.length === 0) continue;
          const existing = this.overrideMap.get(override.tool_sid) ?? [];
          // Merge by scope:wwuid key — no duplicates
          const merged = this.mergeRefs([...existing, ...injectRefs]);
          this.overrideMap.set(override.tool_sid, merged);
        }
      } catch { /* skip corrupt files */ }
    }
  }

  /**
   * Get inject_scope_refs for a given tool_sid, or [] if none.
   */
  getOverride(toolSid: string): ScopeRef[] {
    return this.overrideMap.get(toolSid) ?? [];
  }

  hasAnyOverrides(): boolean {
    return this.overrideMap.size > 0;
  }

  private mergeRefs(refs: ScopeRef[]): ScopeRef[] {
    const map = new Map<string, ScopeRef>();
    for (const ref of refs) {
      const key = `${ref.scope}:${ref.wwuid}`;
      if (!map.has(key)) map.set(key, ref);
    }
    return [...map.values()];
  }

  /**
   * Collect all ancestor directories (inclusive) that contain
   * .wildwest/registry.json, from dir upwards to fs root.
   * Used to find all session-map.json files that might apply
   * to a given town/county/territory workspace.
   */
  static collectAncestorDirs(startDir: string): string[] {
    const dirs: string[] = [];
    let current = startDir;
    const fsRoot = path.parse(current).root;
    while (current && current !== fsRoot) {
      if (fs.existsSync(path.join(current, '.wildwest', 'registry.json'))) {
        dirs.push(current);
      }
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
    return dirs;
  }

  /**
   * Merge override scope_refs into an existing scope_refs array (additive).
   * Returns new merged array; original is not mutated.
   */
  static mergeOverrideInto(existing: ScopeRef[], overrides: ScopeRef[]): ScopeRef[] {
    if (overrides.length === 0) return existing;
    const map = new Map<string, ScopeRef>();
    for (const ref of existing) map.set(`${ref.scope}:${ref.wwuid}`, ref);
    for (const ref of overrides) {
      const key = `${ref.scope}:${ref.wwuid}`;
      if (!map.has(key)) map.set(key, ref);
    }
    return [...map.values()];
  }

  /**
   * Write (or update) a session-map.json file at the given directory.
   * Merges new overrides into any existing entries — never overwrites manually
   * added entries.
   */
  static writeOverrides(dir: string, newOverrides: SessionMapOverride[]): void {
    const mapPath = path.join(dir, '.wildwest', 'session-map.json');
    let existing: SessionMap = { schema_version: '1', overrides: [] };
    if (fs.existsSync(mapPath)) {
      try {
        existing = JSON.parse(fs.readFileSync(mapPath, 'utf8')) as SessionMap;
      } catch { /* start fresh */ }
    }

    // Merge by tool_sid — new entries win on inject_scope_refs, keep note if present
    const byToolSid = new Map<string, SessionMapOverride>();
    for (const o of (existing.overrides ?? [])) byToolSid.set(o.tool_sid, o);
    for (const o of newOverrides) {
      const prev = byToolSid.get(o.tool_sid);
      if (prev) {
        // Additive merge of inject_scope_refs
        const merged = SessionMapService.prototype['mergeRefs']([
          ...(prev.inject_scope_refs ?? []),
          ...(o.inject_scope_refs ?? []),
        ]);
        byToolSid.set(o.tool_sid, { ...prev, inject_scope_refs: merged });
      } else {
        byToolSid.set(o.tool_sid, o);
      }
    }

    const out: SessionMap = {
      schema_version: '1',
      overrides: [...byToolSid.values()].sort((a, b) => a.tool_sid.localeCompare(b.tool_sid)),
    };
    fs.mkdirSync(path.join(dir, '.wildwest'), { recursive: true });
    fs.writeFileSync(mapPath, JSON.stringify(out, null, 2), 'utf8');
  }
}
