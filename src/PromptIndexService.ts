import * as fs from 'fs';
import * as path from 'path';

// ── Raw schema (one entry per user turn, unprocessed) ────────────────────────

export interface RawPromptEntry {
  id: string;               // `${session_wwuid}:${turn_index}`
  session_wwuid: string;
  turn_index: number;
  timestamp: string;
  content: string;          // first 500 chars
  char_count: number;
  tool: string;
  recorder_scope: string;
  scope_alias: string;
  workspace_wwuids: string[];
}

export interface RawPromptIndex {
  schema_version: string;
  updated_at: string;
  total: number;
  prompts: RawPromptEntry[];
}

// ── Predictive schema (deduplicated + scored) ────────────────────────────────

export interface PromptEntry {
  id: string;               // sha-style key: first 12 chars of hex(normKey)
  content: string;          // canonical form (most recent occurrence, up to 500 chars)
  char_count: number;
  frequency: number;        // how many raw occurrences collapsed into this entry
  score: number;            // composite 0–1: frequency + recency + length
  last_used: string;        // ISO timestamp of most recent occurrence
  first_used: string;       // ISO timestamp of earliest occurrence
  tool: string;             // most common tool across occurrences
  recorder_scope: string;   // most common scope
  scope_alias: string;      // most common alias
  occurrences: string[];    // up to 10 raw entry ids (session_wwuid:turn_index)
}

export interface PromptAnalytics {
  raw_total: number;
  unique_total: number;
  filtered_noise: number;
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

// ── Constants ────────────────────────────────────────────────────────────────

const CONTENT_MAX = 500;
const BUILD_THROTTLE_MS = 60_000;
const DEDUP_KEY_LEN = 200;   // chars of normalized content used as dedup key
const MIN_CHAR_COUNT = 20;   // shorter prompts are noise (filters "proceed.", "yes.", single words)

/** Patterns that identify system/tool-generated content, not real user prompts. */
const NOISE_PATTERNS: RegExp[] = [
  /^<[a-z-]+>/i,                            // <local-command-stdout>, <command-name>, etc.
  /^this session is being continued/i,      // session continuation headers
  /^compacted \[/i,                         // compaction notices
  /^\[request interrupted by user\]/i,      // tool interruption messages
  /^logs for your project will appear/i,    // tool output headers
];

// ── Helpers ──────────────────────────────────────────────────────────────────

function normalizeKey(content: string): string {
  return content.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, DEDUP_KEY_LEN);
}

function isNoise(content: string): boolean {
  const trimmed = content.trim();
  if (trimmed.length < MIN_CHAR_COUNT) return true;
  return NOISE_PATTERNS.some(re => re.test(trimmed));
}

/** Simple non-crypto fingerprint for a normalized key string. */
function fingerprint(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

function mostCommon(values: string[]): string {
  const freq: Record<string, number> = {};
  for (const v of values) freq[v] = (freq[v] ?? 0) + 1;
  return Object.entries(freq).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
}

// ── Service ──────────────────────────────────────────────────────────────────

export class PromptIndexService {
  private readonly promptsDir: string;
  private readonly rawPath: string;
  private readonly indexPath: string;
  private cache: PromptIndex | null = null;
  private buildPending = false;
  private lastBuildAt = 0;

  constructor(private readonly exportPath: string) {
    this.promptsDir = path.join(exportPath, 'prompts');
    this.rawPath    = path.join(this.promptsDir, 'raw.json');
    this.indexPath  = path.join(this.promptsDir, 'index.json');
  }

  /**
   * Full pipeline: scan sessions → raw.json → deduplicate/score → index.json.
   * Throttled to once per minute unless force=true.
   */
  async buildIndex(force = false): Promise<{ total: number }> {
    const now = Date.now();
    if (!force && now - this.lastBuildAt < BUILD_THROTTLE_MS) {
      return { total: this.cache?.analytics.unique_total ?? 0 };
    }
    if (this.buildPending) return { total: this.cache?.analytics.unique_total ?? 0 };
    this.buildPending = true;
    try {
      await this._buildRaw();
      const total = await this._buildPredictive();
      this.lastBuildAt = Date.now();
      return { total };
    } finally {
      this.buildPending = false;
    }
  }

  // ── Stage 1: scan sessions → raw.json ──────────────────────────────────────

  private async _buildRaw(): Promise<void> {
    const sessionsDir = path.join(this.exportPath, 'staged', 'storage', 'sessions');
    if (!fs.existsSync(sessionsDir)) return;

    if (!fs.existsSync(this.promptsDir)) {
      fs.mkdirSync(this.promptsDir, { recursive: true });
    }

    const prompts: RawPromptEntry[] = [];
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
        }
      } catch { /* skip bad records */ }
    }

    prompts.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

    const raw: RawPromptIndex = {
      schema_version: '1',
      updated_at: new Date().toISOString(),
      total: prompts.length,
      prompts,
    };

    fs.writeFileSync(this.rawPath, JSON.stringify(raw, null, 2), 'utf8');
  }

  // ── Stage 2: raw.json → deduplicate + score → index.json ───────────────────

  private async _buildPredictive(): Promise<number> {
    if (!fs.existsSync(this.rawPath)) return 0;

    const raw: RawPromptIndex = JSON.parse(fs.readFileSync(this.rawPath, 'utf8'));
    const rawPrompts = raw.prompts;

    // Group by normalized dedup key
    const groups = new Map<string, RawPromptEntry[]>();
    let filteredNoise = 0;

    for (const p of rawPrompts) {
      if (isNoise(p.content)) { filteredNoise++; continue; }
      const key = normalizeKey(p.content);
      const bucket = groups.get(key);
      if (bucket) {
        bucket.push(p);
      } else {
        groups.set(key, [p]);
      }
    }

    // Compute score bounds for normalization
    const maxFreq = Math.max(...Array.from(groups.values()).map(g => g.length), 1);
    const allTs = rawPrompts.map(p => new Date(p.timestamp).getTime()).filter(t => !isNaN(t));
    const minTs = Math.min(...allTs);
    const maxTs = Math.max(...allTs);
    const tsRange = maxTs - minTs || 1;

    // Build predictive entries
    const entries: PromptEntry[] = [];
    const analytics: PromptAnalytics = {
      raw_total: raw.total,
      unique_total: 0,
      filtered_noise: filteredNoise,
      by_tool: {},
      by_scope: {},
      by_scope_alias: {},
    };

    for (const [normKey, bucket] of groups) {
      // Sort bucket newest-first
      bucket.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

      const frequency = bucket.length;
      const last_used = bucket[0].timestamp;
      const first_used = bucket[bucket.length - 1].timestamp;
      const canonical = bucket[0]; // most recent occurrence is canonical

      // Score components (all 0–1)
      const freq_score = Math.log2(frequency + 1) / Math.log2(maxFreq + 1);
      const lastTs = new Date(last_used).getTime();
      const recency_score = isNaN(lastTs) ? 0 : (lastTs - minTs) / tsRange;
      const length_score = Math.min(canonical.char_count / 300, 1.0);
      const score = 0.50 * freq_score + 0.35 * recency_score + 0.15 * length_score;

      const tool = mostCommon(bucket.map(p => p.tool));
      const recorder_scope = mostCommon(bucket.map(p => p.recorder_scope).filter(Boolean));
      const scope_alias = mostCommon(bucket.map(p => p.scope_alias).filter(Boolean));

      entries.push({
        id: fingerprint(normKey),
        content: canonical.content,
        char_count: canonical.char_count,
        frequency,
        score: Math.round(score * 1000) / 1000,
        last_used,
        first_used,
        tool,
        recorder_scope,
        scope_alias,
        occurrences: bucket.slice(0, 10).map(p => p.id),
      });

      analytics.by_tool[tool] = (analytics.by_tool[tool] ?? 0) + 1;
      if (recorder_scope) analytics.by_scope[recorder_scope] = (analytics.by_scope[recorder_scope] ?? 0) + 1;
      if (scope_alias) analytics.by_scope_alias[scope_alias] = (analytics.by_scope_alias[scope_alias] ?? 0) + 1;
    }

    // Sort by score descending — highest predictive value first
    entries.sort((a, b) => b.score - a.score);
    analytics.unique_total = entries.length;

    const index: PromptIndex = {
      schema_version: '2',
      updated_at: new Date().toISOString(),
      analytics,
      prompts: entries,
    };

    fs.writeFileSync(this.indexPath, JSON.stringify(index, null, 2), 'utf8');
    this.cache = index;
    return entries.length;
  }

  // ── Read API ────────────────────────────────────────────────────────────────

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
   * Search prompts. Results are pre-sorted by score; text match filters within that order.
   * scopeAlias narrows to a specific workspace alias. Falls back to unfiltered if no hits.
   */
  search(query: string, scopeAlias?: string, limit = 20): PromptEntry[] {
    const index = this.getIndex();
    if (!index) return [];

    const q = query.toLowerCase().trim();
    let pool = index.prompts;

    if (scopeAlias) {
      const scoped = pool.filter(p => p.scope_alias === scopeAlias);
      pool = scoped.length > 0 ? scoped : pool; // fall back to global if scope has no hits
    }

    if (q.length >= 2) {
      pool = pool.filter(p => p.content.toLowerCase().includes(q));
    }

    return pool.slice(0, limit);
  }

  getAnalytics(): PromptAnalytics | null {
    return this.getIndex()?.analytics ?? null;
  }

  isBuilt(): boolean {
    return fs.existsSync(this.indexPath);
  }

  getRawPath(): string  { return this.rawPath; }
  getPromptsDir(): string { return this.promptsDir; }
  getIndexPath(): string  { return this.indexPath; }
}
