import * as fs from 'fs';
import * as path from 'path';

export interface PromptEntry {
  id: string;               // `${session_wwuid}:${turn_index}`
  session_wwuid: string;
  turn_index: number;
  timestamp: string;
  content: string;          // first 500 chars
  char_count: number;
  tool: string;
  recorder_scope: string;
  scope_alias: string;      // alias of the primary town-scope ref
  workspace_wwuids: string[];
}

export interface PromptAnalytics {
  total_prompts: number;
  by_tool: Record<string, number>;
  by_scope: Record<string, number>;
  by_scope_alias: Record<string, number>;
}

export interface PromptIndex {
  schema_version: string;
  updated_at: string;
  analytics: PromptAnalytics;
  prompts: PromptEntry[];
}

const CONTENT_MAX = 500;
const BUILD_THROTTLE_MS = 60_000;

export class PromptIndexService {
  private readonly promptsDir: string;
  private readonly indexPath: string;
  private cache: PromptIndex | null = null;
  private buildPending = false;
  private lastBuildAt = 0;

  constructor(private readonly exportPath: string) {
    this.promptsDir = path.join(exportPath, 'prompts');
    this.indexPath = path.join(this.promptsDir, 'index.json');
  }

  /** Full rebuild from all session records. Throttled to once per minute unless forced. */
  async buildIndex(force = false): Promise<{ total: number }> {
    const now = Date.now();
    if (!force && now - this.lastBuildAt < BUILD_THROTTLE_MS) {
      return { total: this.cache?.analytics.total_prompts ?? 0 };
    }
    if (this.buildPending) return { total: this.cache?.analytics.total_prompts ?? 0 };
    this.buildPending = true;
    try {
      const total = await this._doBuild();
      this.lastBuildAt = Date.now();
      return { total };
    } finally {
      this.buildPending = false;
    }
  }

  private async _doBuild(): Promise<number> {
    const sessionsDir = path.join(this.exportPath, 'staged', 'storage', 'sessions');
    if (!fs.existsSync(sessionsDir)) return 0;

    if (!fs.existsSync(this.promptsDir)) {
      fs.mkdirSync(this.promptsDir, { recursive: true });
    }

    const prompts: PromptEntry[] = [];
    const analytics: PromptAnalytics = {
      total_prompts: 0,
      by_tool: {},
      by_scope: {},
      by_scope_alias: {},
    };

    const files = fs.readdirSync(sessionsDir).filter(f => f.endsWith('.json'));
    for (const file of files) {
      try {
        const record = JSON.parse(fs.readFileSync(path.join(sessionsDir, file), 'utf8'));
        const session_wwuid = record.wwuid as string;
        const tool = (record.tool as string) || 'unknown';
        const recorder_scope = (record.recorder_scope as string) || '';
        const scope_refs: Array<Record<string, unknown>> = Array.isArray(record.scope_refs) ? record.scope_refs : [];
        const primary_ref = scope_refs.find(r => r['scope'] === 'town') ?? scope_refs[0];
        const scope_alias = (primary_ref?.['alias'] as string) || '';
        const workspace_wwuids: string[] = Array.isArray(record.workspace_wwuids) ? record.workspace_wwuids : [];

        for (const turn of (record.turns ?? [])) {
          if (turn.role !== 'user') continue;
          const raw = (turn.content as string) || '';
          if (!raw.trim()) continue;

          prompts.push({
            id: `${session_wwuid}:${turn.turn_index}`,
            session_wwuid,
            turn_index: turn.turn_index,
            timestamp: turn.timestamp,
            content: raw.slice(0, CONTENT_MAX),
            char_count: raw.length,
            tool,
            recorder_scope,
            scope_alias,
            workspace_wwuids,
          });

          analytics.by_tool[tool] = (analytics.by_tool[tool] ?? 0) + 1;
          if (recorder_scope) {
            analytics.by_scope[recorder_scope] = (analytics.by_scope[recorder_scope] ?? 0) + 1;
          }
          if (scope_alias) {
            analytics.by_scope_alias[scope_alias] = (analytics.by_scope_alias[scope_alias] ?? 0) + 1;
          }
        }
      } catch { /* skip bad records */ }
    }

    prompts.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    analytics.total_prompts = prompts.length;

    const index: PromptIndex = {
      schema_version: '1',
      updated_at: new Date().toISOString(),
      analytics,
      prompts,
    };

    fs.writeFileSync(this.indexPath, JSON.stringify(index, null, 2), 'utf8');
    this.cache = index;
    return prompts.length;
  }

  getIndex(): PromptIndex | null {
    if (this.cache) return this.cache;
    if (!fs.existsSync(this.indexPath)) return null;
    try {
      this.cache = JSON.parse(fs.readFileSync(this.indexPath, 'utf8'));
      return this.cache;
    } catch { return null; }
  }

  invalidateCache(): void {
    this.cache = null;
  }

  /**
   * Search prompts by text query. Returns newest-first results.
   * scopeAlias filters by the primary town alias when provided.
   */
  search(query: string, scopeAlias?: string, limit = 20): PromptEntry[] {
    const index = this.getIndex();
    if (!index) return [];

    const q = query.toLowerCase().trim();
    let results = index.prompts;

    if (scopeAlias) {
      results = results.filter(p => p.scope_alias === scopeAlias);
    }

    if (q.length >= 2) {
      results = results.filter(p => p.content.toLowerCase().includes(q));
    }

    return results.slice(0, limit);
  }

  getAnalytics(): PromptAnalytics | null {
    return this.getIndex()?.analytics ?? null;
  }

  isBuilt(): boolean {
    return fs.existsSync(this.indexPath);
  }

  getPromptsDir(): string { return this.promptsDir; }
  getIndexPath(): string { return this.indexPath; }
}
