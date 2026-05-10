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
  scope_refs: PromptScopeRef[];
}

export interface RawPromptIndex {
  schema_version: string;
  updated_at: string;
  total: number;
  prompts: RawPromptEntry[];
}

// ── Predictive schema (deduplicated + scored) ────────────────────────────────

export type PromptKind =
  | 'session_bootstrap'
  | 'telegraph'
  | 'implementation'
  | 'review'
  | 'status_check'
  | 'authorization'
  | 'continuation'
  | 'terminal_output'
  | 'general';

export interface PromptScopeRef {
  scope: string;
  wwuid: string;
  alias: string;
  path?: string;
}

export interface PromptEntry {
  id: string;               // sha-style key: first 12 chars of hex(normKey)
  content: string;          // canonical form (most recent occurrence, up to 500 chars)
  char_count: number;
  kind: PromptKind;
  frequency: number;        // how many raw occurrences collapsed into this entry
  score: number;            // composite 0–1: frequency + recency + length
  reusable_score: number;   // 0–1 estimate that this is a reusable prompt template
  framework_compliant: boolean;
  compliance_flags: string[];
  last_used: string;        // ISO timestamp of most recent occurrence
  first_used: string;       // ISO timestamp of earliest occurrence
  tool: string;             // most common tool across occurrences
  recorder_scope: string;   // most common scope
  scope_alias: string;      // most common alias
  scope_refs: PromptScopeRef[];
  scope_lineage: string[];  // aliases from all known scope refs for scoped search
  occurrences: string[];    // up to 10 raw entry ids (session_wwuid:turn_index)
}

export interface PromptAnalytics {
  raw_total: number;
  unique_total: number;
  filtered_noise: number;
  by_tool: Record<string, number>;
  by_scope: Record<string, number>;
  by_scope_alias: Record<string, number>;
  by_kind: Record<string, number>;
  framework_violations: Record<string, number>;
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
  /^\[terminal [\w-]+ notification:/i,       // Copilot terminal notifications
  /^›\s+(metro waiting|web is waiting|press\s+[a-z]|using development build)/i,
  /^metro waiting on\b/i,
  /^os bundling failed\b/i,
  /^ios bundl(?:ed|ing) failed\b/i,
  /^nx run\b/i,
  /^verce?l?:?\s+\d{2}:\d{2}:\d{2}\.\d{3}\s+/i,
  /^continue from where you left off\.?$/i,
];

// ── Helpers ──────────────────────────────────────────────────────────────────

function normalizeKey(content: string): string {
  return content.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, DEDUP_KEY_LEN);
}

function isNoise(content: string): boolean {
  const trimmed = content.trim();
  if (trimmed.length < MIN_CHAR_COUNT) return true;
  if (NOISE_PATTERNS.some(re => re.test(trimmed))) return true;
  return classifyPrompt(trimmed) === 'terminal_output';
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

function classifyPrompt(content: string): PromptKind {
  const trimmed = content.trim();

  if (
    /^\[terminal [\w-]+ notification:/i.test(trimmed) ||
    /^›\s+(metro waiting|web is waiting|press\s+[a-z]|using development build)/i.test(trimmed) ||
    /^metro waiting on\b/i.test(trimmed) ||
    /^os bundling failed\b/i.test(trimmed) ||
    /^ios bundl(?:ed|ing) failed\b/i.test(trimmed) ||
    /\b(starting metro bundler|react native version mismatch|xcodebuild|pod install)\b/i.test(trimmed)
  ) return 'terminal_output';

  if (
    /authorized push|approved,\s*merge|merge authorization|push authorization/i.test(trimmed) &&
    trimmed.length < 220
  ) return 'authorization';

  if (
    /^(continue from where you left off|proceed|do all|step by step|good enough\.?\s*proceed)/i.test(trimmed) ||
    /^(thoughts\?|recommendation\?|best practice\?)$/i.test(trimmed)
  ) return 'continuation';

  if (
    /declare your model and version|run [`"]?date[`"]?|chat title|\/rename|cold start/i.test(trimmed)
  ) return 'session_bootstrap';

  if (
    /^📬\s+\[from /i.test(trimmed) ||
    /^# telegraph memo/i.test(trimmed) ||
    /\b(to|from):\s*(CD|TM|HG|S|RA|M|DM|DS|aCD)\b/i.test(trimmed) ||
    /\btelegraph\b|\bmemo\b/i.test(trimmed)
  ) return 'telegraph';

  if (
    /\b(review|comment|assessment|recommendation|gap|inconsisten|audit)\b/i.test(trimmed)
  ) return 'review';

  if (
    /\b(monitor|check|status|progress|git status|new commits|inbox)\b/i.test(trimmed)
  ) return 'status_check';

  if (
    /\b(implement|create branch|fix|update|add|refactor|release|install|test)\b/i.test(trimmed)
  ) return 'implementation';

  return 'general';
}

function frameworkComplianceFlags(content: string): string[] {
  const flags = new Set<string>();
  const lower = content.toLowerCase();

  if (/\bdevpair\b|\bdev pair\b/i.test(content)) flags.add('pre_v1_devpair_term');
  if (/\b(to|from):\s*(CD|TM|HG|DM|DS|aCD)\([A-Z][A-Za-z0-9]*\)/.test(content)) {
    flags.add('dyad_in_telegraph_address');
  }
  if (/\bto[-:\s]+(?:TM|HG|DM|M)(?:\b|--)/i.test(content) && !/\bto[-:\s]+(?:TM|HG|DM|M)\([^)]*\*/i.test(content)) {
    flags.add('bare_town_role_address');
  }
  if (/\bCD\(wildwest-ai\)|\bTM\(RHk\)|\bCD\(RSn\)/i.test(content)) {
    flags.add('identity_scope_collision');
  }
  if (/\bMayor\b|to:\s*Mayor|to-Mayor/i.test(content)) flags.add('noncanonical_mayor_token');
  if (/\bc(?:cc|gc|cx)\b/.test(lower)) flags.add('legacy_channel_token');
  if (/\/Users\/reneyap\/|~\/|\.worktrees\/|docs\/sessions\/|memo-to-rc/i.test(content)) {
    flags.add('nonportable_path_or_session_artifact');
  }

  return Array.from(flags);
}

function kindReusableWeight(kind: PromptKind): number {
  switch (kind) {
    case 'implementation': return 0.95;
    case 'review': return 0.90;
    case 'session_bootstrap': return 0.85;
    case 'telegraph': return 0.80;
    case 'status_check': return 0.70;
    case 'general': return 0.55;
    case 'authorization': return 0.20;
    case 'continuation': return 0.15;
    case 'terminal_output': return 0.0;
  }
}

function reusableScore(kind: PromptKind, flags: string[]): number {
  const penalty = flags.reduce((sum, flag) => {
    if (flag === 'nonportable_path_or_session_artifact') return sum + 0.18;
    return sum + 0.10;
  }, 0);
  return Math.max(0, Math.min(1, kindReusableWeight(kind) - penalty));
}

function normalizeScopeRef(ref: Record<string, unknown>): PromptScopeRef | null {
  const scope = typeof ref['scope'] === 'string' ? ref['scope'] : '';
  const wwuid = typeof ref['wwuid'] === 'string' ? ref['wwuid'] : '';
  const alias = typeof ref['alias'] === 'string' ? ref['alias'] : '';
  const refPath = typeof ref['path'] === 'string' ? ref['path'] : undefined;
  if (!scope && !wwuid && !alias) return null;
  return { scope, wwuid, alias, ...(refPath ? { path: refPath } : {}) };
}

function collectScopeRefs(bucket: RawPromptEntry[]): PromptScopeRef[] {
  const byKey = new Map<string, PromptScopeRef>();
  for (const prompt of bucket) {
    for (const ref of prompt.scope_refs ?? []) {
      const key = ref.wwuid || `${ref.scope}:${ref.alias}`;
      if (!key || byKey.has(key)) continue;
      byKey.set(key, ref);
    }
  }
  return Array.from(byKey.values());
}

function scopeLineage(scopeRefs: PromptScopeRef[], fallbackAlias: string): string[] {
  const aliases = scopeRefs.map(ref => ref.alias).filter(Boolean);
  if (fallbackAlias) aliases.unshift(fallbackAlias);
  return Array.from(new Set(aliases));
}

export interface PromptSearchOptions {
  includeGlobalFallback?: boolean;
  includeScopeLineage?: boolean;
  kinds?: PromptKind[];
  excludeKinds?: PromptKind[];
  compliantOnly?: boolean;
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
   * Two-stage pipeline:
   *   Stage 1 — raw.json: incremental if raw.json exists (scan only sessions newer
   *             than raw.json.updated_at and merge); full scan if raw.json is missing.
   *   Stage 2 — index.json: always rebuilt from full raw.json (dedup + score).
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
  //
  // If raw.json exists: incremental — only scan sessions with last_turn_at
  // newer than raw.json.updated_at, then merge new prompts in.
  // If raw.json doesn't exist: full scan of all sessions.

  private async _buildRaw(): Promise<void> {
    const sessionsDir = path.join(this.exportPath, 'staged', 'storage', 'sessions');
    if (!fs.existsSync(sessionsDir)) return;

    if (!fs.existsSync(this.promptsDir)) {
      fs.mkdirSync(this.promptsDir, { recursive: true });
    }

    // Load existing raw (if any) to determine cutoff and existing id set
    let existingPrompts: RawPromptEntry[] = [];
    let cutoff: string | null = null;

    if (fs.existsSync(this.rawPath)) {
      try {
        const existing: RawPromptIndex = JSON.parse(fs.readFileSync(this.rawPath, 'utf8'));
        existingPrompts = existing.prompts ?? [];
        cutoff = existing.updated_at ?? null;
      } catch { /* treat as missing */ }
    }

    const existingIds = new Set(existingPrompts.map(p => p.id));
    const newPrompts: RawPromptEntry[] = [];
    const files = fs.readdirSync(sessionsDir).filter(f => f.endsWith('.json'));

    for (const file of files) {
      try {
        const record = JSON.parse(fs.readFileSync(path.join(sessionsDir, file), 'utf8'));

        // Incremental: skip sessions not updated since last raw build
        if (cutoff && record.last_turn_at && record.last_turn_at <= cutoff) continue;

        const session_wwuid = record.wwuid as string;
        const tool = (record.tool as string) || 'unknown';
        const recorder_scope = (record.recorder_scope as string) || '';
        const scope_refs: Array<Record<string, unknown>> = Array.isArray(record.scope_refs) ? record.scope_refs : [];
        const normalized_scope_refs = scope_refs
          .map(normalizeScopeRef)
          .filter((ref): ref is PromptScopeRef => ref !== null);
        const primary_ref =
          scope_refs.find(r => r['scope'] === recorder_scope) ??
          scope_refs.find(r => r['scope'] === 'town') ??
          scope_refs[0];
        const scope_alias = (primary_ref?.['alias'] as string) || '';
        const workspace_wwuids: string[] = Array.isArray(record.workspace_wwuids) ? record.workspace_wwuids : [];

        for (const turn of (record.turns ?? [])) {
          if (turn.role !== 'user') continue;
          const raw = (turn.content as string) || '';
          if (!raw.trim()) continue;

          const id = `${session_wwuid}:${turn.turn_index}`;
          if (existingIds.has(id)) continue; // already in raw

          newPrompts.push({
            id,
            session_wwuid,
            turn_index: turn.turn_index,
            timestamp: turn.timestamp,
            content: raw.slice(0, CONTENT_MAX),
            char_count: raw.length,
            tool,
            recorder_scope,
            scope_alias,
            workspace_wwuids,
            scope_refs: normalized_scope_refs,
          });
        }
      } catch { /* skip bad records */ }
    }

    // Merge: new prompts prepended (newest-first order maintained)
    const merged = [...newPrompts, ...existingPrompts];
    merged.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

    const raw: RawPromptIndex = {
      schema_version: '1',
      updated_at: new Date().toISOString(),
      total: merged.length,
      prompts: merged,
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
      by_kind: {},
      framework_violations: {},
    };

    for (const [normKey, bucket] of groups) {
      // Sort bucket newest-first
      bucket.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

      const frequency = bucket.length;
      const last_used = bucket[0].timestamp;
      const first_used = bucket[bucket.length - 1].timestamp;
      const canonical = bucket[0]; // most recent occurrence is canonical
      const kind = classifyPrompt(canonical.content);
      const compliance_flags = frameworkComplianceFlags(canonical.content);
      const prompt_reusable_score = reusableScore(kind, compliance_flags);
      const framework_compliant = compliance_flags.length === 0;

      // Score components (all 0–1)
      const freq_score = Math.log2(frequency + 1) / Math.log2(maxFreq + 1);
      const lastTs = new Date(last_used).getTime();
      const recency_score = isNaN(lastTs) ? 0 : (lastTs - minTs) / tsRange;
      const length_score = Math.min(canonical.char_count / 300, 1.0);
      const compliance_score = framework_compliant ? 1.0 : Math.max(0, 1 - compliance_flags.length * 0.18);
      const score =
        0.30 * freq_score +
        0.20 * recency_score +
        0.10 * length_score +
        0.25 * prompt_reusable_score +
        0.15 * compliance_score;

      const tool = mostCommon(bucket.map(p => p.tool));
      const recorder_scope = mostCommon(bucket.map(p => p.recorder_scope).filter(Boolean));
      const scope_alias = mostCommon(bucket.map(p => p.scope_alias).filter(Boolean));
      const scope_refs = collectScopeRefs(bucket);
      const scope_lineage = scopeLineage(scope_refs, scope_alias);

      entries.push({
        id: fingerprint(normKey),
        content: canonical.content,
        char_count: canonical.char_count,
        kind,
        frequency,
        score: Math.round(score * 1000) / 1000,
        reusable_score: Math.round(prompt_reusable_score * 1000) / 1000,
        framework_compliant,
        compliance_flags,
        last_used,
        first_used,
        tool,
        recorder_scope,
        scope_alias,
        scope_refs,
        scope_lineage,
        occurrences: bucket.slice(0, 10).map(p => p.id),
      });

      analytics.by_tool[tool] = (analytics.by_tool[tool] ?? 0) + 1;
      if (recorder_scope) analytics.by_scope[recorder_scope] = (analytics.by_scope[recorder_scope] ?? 0) + 1;
      if (scope_alias) analytics.by_scope_alias[scope_alias] = (analytics.by_scope_alias[scope_alias] ?? 0) + 1;
      analytics.by_kind[kind] = (analytics.by_kind[kind] ?? 0) + 1;
      for (const flag of compliance_flags) {
        analytics.framework_violations[flag] = (analytics.framework_violations[flag] ?? 0) + 1;
      }
    }

    // Sort by score descending — highest predictive value first
    entries.sort((a, b) => b.score - a.score);
    analytics.unique_total = entries.length;

    const index: PromptIndex = {
      schema_version: '3',
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
   * scopeAlias narrows to one or more workspace aliases. Global fallback is opt-in so
   * completions do not silently cross scope boundaries.
   */
  search(
    query: string,
    scopeAlias?: string | string[],
    limit = 20,
    options: PromptSearchOptions = {},
  ): PromptEntry[] {
    const index = this.getIndex();
    if (!index) return [];

    const q = query.toLowerCase().trim();
    let pool = index.prompts;
    const includeScopeLineage = options.includeScopeLineage ?? true;
    const excludeKinds = new Set<PromptKind>(options.excludeKinds ?? ['terminal_output']);
    const includeKinds = options.kinds ? new Set<PromptKind>(options.kinds) : null;

    if (scopeAlias) {
      const aliases = Array.isArray(scopeAlias) ? scopeAlias.filter(Boolean) : [scopeAlias].filter(Boolean);
      if (aliases.length > 0) {
        const scoped = pool.filter(p => aliases.some(alias =>
          p.scope_alias === alias ||
          (includeScopeLineage && p.scope_lineage?.includes(alias)) ||
          (includeScopeLineage && p.scope_refs?.some(ref => ref.alias === alias))
        ));
        pool = scoped.length > 0 || !options.includeGlobalFallback ? scoped : pool;
      }
    }

    if (includeKinds) {
      pool = pool.filter(p => includeKinds.has(p.kind));
    }
    if (excludeKinds.size > 0) {
      pool = pool.filter(p => !excludeKinds.has(p.kind));
    }
    if (options.compliantOnly) {
      pool = pool.filter(p => p.framework_compliant);
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
