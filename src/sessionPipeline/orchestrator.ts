/**
 * Session Export Pipeline — Main Orchestrator
 * 
 * Coordinates the full delta export flow:
 * raw session → transform → packet → storage
 * 
 * Replaces the timer-based full-export with cursor-based delta packets.
 */

import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { getTransformer } from './transformers';
import { PacketWriter } from './packetWriter';
import { NormalizedTurn, ScopeRef, SessionPacket, WildWestScope } from './types';
import { generateWwuid, generateDeviceId, getCursorType } from './utils';
import { redactTurns } from '../PrivacyFilter';

export interface PipelineOptions {
  /**
   * Base directory for sessions (e.g., ~/wildwest/sessions)
   */
  sessionsDir: string;
  /**
   * Git username of session author (e.g., 'reneyap')
   */
  author: string;
  /**
   * Optional project path (used for SessionRecord metadata)
   */
  projectPath?: string;
  /**
   * wwuid from the recording town's .wildwest/registry.json.
   * Used as the stable session attribution key — avoids fragile project_path inference.
   */
  recorderWwuid?: string;
  /**
   * When true, redact secrets, tokens, and absolute paths from turn
   * content before writing packets (default: false).
   */
  privacyMode?: boolean;
  /**
   * User home directory used for path redaction (default: process.env.HOME)
   */
  homeDir?: string;
}

export interface ExportSession {
  tool: 'cld' | 'cpt' | 'ccx';
  tool_sid: string;
  rawPath: string; // Path to raw session file
}

export interface AttributionResult {
  projectPath: string;
  recorderWwuid: string;
  recorderScope: WildWestScope | '';
  workspaceWwuids: string[];
  scopeRefs: ScopeRef[];
}

/**
 * Main pipeline orchestrator
 */
export class SessionExportPipeline {
  private sessionsDir: string;
  private author: string;
  private projectPath: string;
  private recorderWwuid: string;
  private stagedDir: string;
  private packetWriter: PacketWriter;
  private device_id: string;
  private privacyMode: boolean;
  private homeDir: string;

  constructor(options: PipelineOptions) {
    this.sessionsDir = options.sessionsDir;
    this.author = options.author;
    this.projectPath = options.projectPath || '';
    this.recorderWwuid = options.recorderWwuid || '';
    this.stagedDir = path.join(this.sessionsDir, 'staged');
    this.device_id = generateDeviceId();
    this.privacyMode = options.privacyMode ?? false;
    this.homeDir = options.homeDir ?? process.env['HOME'] ?? '';

    this.packetWriter = new PacketWriter({
      stagedDir: this.stagedDir,
      author: this.author,
      device_id: this.device_id,
    });
  }

  /**
   * Export a session — full pipeline from raw to storage
   * 
   * @param session Export session (tool, tool_sid, rawPath)
   * @param closed Whether this is the final export for the session
   * @throws Error if transform, packet, or storage operations fail
   */
  async exportSession(session: ExportSession, closed: boolean = false): Promise<void> {
    const { tool, tool_sid, rawPath } = session;

    // 1. Read raw file
    if (!fs.existsSync(rawPath)) {
      throw new Error(`Raw session file not found: ${rawPath}`);
    }
    const rawContent = fs.readFileSync(rawPath, 'utf8');

    // 2. Transform
    const transformer = getTransformer(tool);
    const rawSession = transformer.parseRaw(rawContent);
    const allTurns = transformer.transformTurns(rawSession);
    const metadata = transformer.getSessionMetadata(rawSession);

    if (allTurns.length === 0) {
      // Empty session — skip
      return;
    }

    // 3. Apply privacy filter (if enabled)
    const filteredTurns = this.privacyMode
      ? redactTurns(allTurns, this.homeDir)
      : allTurns;

    // 3. Generate wwuid
    const wwuid = generateWwuid('session', tool, tool_sid);

    // 4. Resolve attribution from session data — deterministic, window-agnostic.
    // cld/ccx: project_path is in the raw file; look up the path's registry for wwuid.
    // cpt: no built-in project field; find workspace with most cwd/ref signals, look up its registry.
    const {
      projectPath: resolvedProjectPath,
      recorderWwuid: resolvedRecorderWwuid,
      recorderScope: resolvedRecorderScope,
      workspaceWwuids: resolvedWorkspaceWwuids,
      scopeRefs: resolvedScopeRefs,
    } =
      this.resolveAttribution(tool, rawSession, metadata.project_path);

    // 5. Check cursor to determine delta
    const newTurns = this.filterNewTurns(wwuid, filteredTurns);

    if (newTurns.length === 0 && !closed) {
      // No new turns — patch attribution if existing record has none yet
      this.patchAttribution(
        wwuid,
        resolvedProjectPath,
        resolvedRecorderWwuid,
        resolvedRecorderScope,
        resolvedWorkspaceWwuids,
        resolvedScopeRefs,
      );
      return;
    }

    // 6. Write packet
    const turnsForPacket = newTurns.length > 0 ? newTurns : filteredTurns;
    try {
      await this.packetWriter.writePacket(wwuid, tool, tool_sid, turnsForPacket, closed);
    } catch (error) {
      throw new Error(`Packet write failed: ${error}`);
    }

    // 7. Apply to storage
    try {
      const packet: SessionPacket = {
        schema_version: '1',
        packet_id: uuidv4(),
        wwuid,
        wwuid_type: 'session',
        tool,
        tool_sid,
        author: this.author,
        device_id: this.device_id,
        seq_from: turnsForPacket[0].turn_index,
        seq_to: turnsForPacket[turnsForPacket.length - 1].turn_index,
        created_at: new Date().toISOString(),
        closed,
        turns: turnsForPacket,
      };
      await this.packetWriter.applyPacketToStorage(
        packet,
        resolvedProjectPath,
        metadata.session_type,
        {
          type: getCursorType(tool),
          value: turnsForPacket[turnsForPacket.length - 1].meta?.tool_cursor_value || turnsForPacket[turnsForPacket.length - 1].turn_index,
        },
        metadata.created_at,
        resolvedRecorderWwuid || undefined,
        resolvedRecorderScope || undefined,
        resolvedWorkspaceWwuids,
        resolvedScopeRefs,
      );
    } catch (error) {
      throw new Error(`Storage update failed: ${error}`);
    }
  }

  /**
   * Filter to only new turns (not already in storage)
   * 
   * Checks existing session record and returns turns with
   * turn_index >= (max existing + 1)
   */
  private filterNewTurns(wwuid: string, allTurns: NormalizedTurn[]): NormalizedTurn[] {
    const recordPath = path.join(
      this.stagedDir,
      'storage',
      'sessions',
      `${wwuid}.json`
    );

    if (!fs.existsSync(recordPath)) {
      // No existing record — all turns are new
      return allTurns;
    }

    const record = JSON.parse(fs.readFileSync(recordPath, 'utf8'));
    const existingIndexes = new Set((record.turns || []).map((t: { turn_index: number }) => t.turn_index));
    const maxExisting = Math.max(...(Array.from(existingIndexes) as number[]), -1);

    // Return turns after max existing
    return allTurns.filter((t) => t.turn_index > maxExisting);
  }

  /**
   * Patch recorder_wwuid and project_path on an existing record when the current
   * window can claim it but the record was written with empty attribution by another
   * window that processed it first.
   */
  private patchAttribution(
    wwuid: string,
    projectPath: string,
    recorderWwuid: string,
    recorderScope: WildWestScope | '',
    workspaceWwuids: string[],
    scopeRefs: ScopeRef[],
  ): void {
    const recordPath = path.join(this.stagedDir, 'storage', 'sessions', `${wwuid}.json`);
    if (!fs.existsSync(recordPath)) return;
    try {
      const record = JSON.parse(fs.readFileSync(recordPath, 'utf8')) as Record<string, unknown>;
      let dirty = false;
      if (!record['recorder_wwuid'] && recorderWwuid) {
        record['recorder_wwuid'] = recorderWwuid;
        dirty = true;
      }
      if (!record['recorder_scope'] && recorderScope) {
        record['recorder_scope'] = recorderScope;
        dirty = true;
      }
      if (!record['project_path'] && projectPath) {
        record['project_path'] = projectPath;
        dirty = true;
      }
      const existingWwuids = Array.isArray(record['workspace_wwuids'])
        ? record['workspace_wwuids'] as string[]
        : [];
      const mergedWwuids = [...new Set([...existingWwuids, ...workspaceWwuids].filter((wwuid) => wwuid !== ''))];
      if (mergedWwuids.length !== existingWwuids.length) {
        record['workspace_wwuids'] = mergedWwuids;
        dirty = true;
      }
      const existingScopeRefs = Array.isArray(record['scope_refs'])
        ? record['scope_refs'] as ScopeRef[]
        : [];
      const mergedScopeRefs = this.mergeScopeRefs(existingScopeRefs, scopeRefs);
      if (mergedScopeRefs.length !== existingScopeRefs.length) {
        record['scope_refs'] = mergedScopeRefs;
        dirty = true;
      }
      if (!dirty) return;
      fs.writeFileSync(recordPath, JSON.stringify(record, null, 2), 'utf8');
      this.packetWriter.patchIndexEntry(
        wwuid,
        (record['project_path'] as string) || projectPath,
        (record['recorder_wwuid'] as string) || recorderWwuid,
        (record['recorder_scope'] as WildWestScope | '') || recorderScope,
        mergedWwuids,
        mergedScopeRefs,
      );
    } catch { /* skip */ }
  }

  /**
   * Get the stagedDir for external callers
   */
  getStagedDir(): string {
    return this.stagedDir;
  }

  /**
   * Get device_id
   */
  getDeviceId(): string {
    return this.device_id;
  }

  /**
   * Get author
   */
  getAuthor(): string {
    return this.author;
  }

  /**
   * Get recorderWwuid (from recording town's .wildwest/registry.json)
   */
  getRecorderWwuid(): string {
    return this.recorderWwuid;
  }

  /**
   * Get projectPath (workspace root, registry-backed)
   */
  getProjectPath(): string {
    return this.projectPath;
  }

  /**
   * Infer project_path for a Copilot session that lacks a workspaceFolder field.
   * Checks (in order):
   *   1. contentReferences[].reference.fsPath — attached file/folder references
   *   2. response[].toolSpecificData.cwd      — tool invocation working directory
   * Returns workspaceRoot if any evidence points there, otherwise ''.
   */
  /**
   * Resolve attribution from session data alone — no dependency on recording window.
   *
   * cld/ccx: project_path is in the raw file. Look up that path's registry for wwuid.
   * cpt: count signals (cwd + contentRef hits) per workspace root found in the session,
   *      pick the one with the most hits, look up its registry.
   *
   * Returns { projectPath, recorderWwuid } — both may be empty if no evidence found.
   */
  // Minimum signal count for a workspace to be included in workspace_wwuids
  private static readonly SIGNAL_THRESHOLD = 3;

  resolveAttribution(
    tool: string,
    rawSession: unknown,
    metadataProjectPath: string
  ): AttributionResult {
    // cld / ccx: project_path is authoritative from raw file
    if (metadataProjectPath) {
      const workspaceRoot = this.findWorkspaceRoot(metadataProjectPath) || metadataProjectPath;
      const recorderRef = this.readRegistryScopeRef(workspaceRoot);
      const scopeRefs = this.collectScopeRefs(workspaceRoot);
      return {
        projectPath: metadataProjectPath,
        recorderWwuid: recorderRef?.wwuid ?? '',
        recorderScope: recorderRef?.scope ?? '',
        workspaceWwuids: recorderRef?.wwuid ? [recorderRef.wwuid] : [],
        scopeRefs,
      };
    }

    // cpt: infer from signals across all workspace roots mentioned in the session
    if (tool !== 'cpt') {
      return { projectPath: '', recorderWwuid: '', recorderScope: '', workspaceWwuids: [], scopeRefs: [] };
    }

    const session = rawSession as Record<string, unknown>;
    const requests = (session['requests'] as Record<string, unknown>[]) ?? [];

    // Count signal hits per resolved workspace root (walk up path to find registry)
    const hits = new Map<string, number>(); // workspaceRoot → count

    const tally = (p: string) => {
      if (!p) return;
      const root = this.findWorkspaceRoot(p);
      if (root) hits.set(root, (hits.get(root) ?? 0) + 1);
    };

    for (const req of requests) {
      for (const ref of (req['contentReferences'] as Record<string, unknown>[]) ?? []) {
        tally(((ref['reference'] as Record<string, unknown>)?.['fsPath'] as string) ?? '');
      }
      for (const item of (req['response'] as Record<string, unknown>[]) ?? []) {
        const cwdRaw = (item['toolSpecificData'] as Record<string, unknown>)?.['cwd'];
        const cwdDict = cwdRaw as Record<string, unknown> | undefined;
        tally(typeof cwdRaw === 'string' ? cwdRaw
          : (cwdDict?.['fsPath'] as string) ?? (cwdDict?.['path'] as string) ?? '');
      }
    }

    if (hits.size === 0) return { projectPath: '', recorderWwuid: '', recorderScope: '', workspaceWwuids: [], scopeRefs: [] };

    // Primary: workspace with the most signals
    const best = [...hits.entries()].reduce((a, b) => b[1] > a[1] ? b : a);
    const projectPath = best[0];
    const recorderRef = this.readRegistryScopeRef(projectPath);

    // All workspaces meeting the signal threshold (for multi-workspace sessions)
    const significantRoots = [...hits.entries()]
      .filter(([, count]) => count >= SessionExportPipeline.SIGNAL_THRESHOLD);
    const workspaceWwuids = [...new Set([
      recorderRef?.wwuid ?? '',
      ...significantRoots.map(([root]) => this.readRegistryScopeRef(root)?.wwuid ?? ''),
    ].filter((wwuid) => wwuid !== ''))];
    const scopeRefs = this.mergeScopeRefs(
      this.collectScopeRefs(best[0], best[1]),
      ...significantRoots.map(([root, count]) => this.collectScopeRefs(root, count)),
    );

    return {
      projectPath,
      recorderWwuid: recorderRef?.wwuid ?? '',
      recorderScope: recorderRef?.scope ?? '',
      workspaceWwuids,
      scopeRefs,
    };
  }

  /**
   * Walk up from a file/dir path to find the nearest ancestor that has
   * .wildwest/registry.json. Returns that directory path or '' if not found.
   */
  private findWorkspaceRoot(filePath: string): string {
    let current = fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()
      ? filePath : path.dirname(filePath);
    const fsRoot = path.parse(current).root;
    while (current && current !== fsRoot) {
      if (fs.existsSync(path.join(current, '.wildwest', 'registry.json'))) {
        return current;
      }
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
    return '';
  }

  private isWildWestScope(value: unknown): value is WildWestScope {
    return value === 'town' || value === 'county' || value === 'territory';
  }

  private readRegistryScopeRef(workspacePath: string, signalCount?: number): ScopeRef | null {
    if (!workspacePath) return null;
    try {
      const regPath = path.join(workspacePath, '.wildwest', 'registry.json');
      if (!fs.existsSync(regPath)) return null;
      const reg = JSON.parse(fs.readFileSync(regPath, 'utf8')) as Record<string, unknown>;
      const scope = reg['scope'];
      const wwuid = (reg['wwuid'] as string) || '';
      if (!wwuid || !this.isWildWestScope(scope)) return null;
      return {
        scope,
        wwuid,
        alias: (reg['alias'] as string) || path.basename(workspacePath),
        path: workspacePath,
        ...(signalCount !== undefined ? { signal_count: signalCount } : {}),
      };
    } catch { return null; }
  }

  private collectScopeRefs(workspacePath: string, signalCount?: number): ScopeRef[] {
    const refs: ScopeRef[] = [];
    let current = workspacePath;
    const fsRoot = path.parse(current).root;
    while (current && current !== fsRoot) {
      const ref = this.readRegistryScopeRef(current, signalCount);
      if (ref) refs.push(ref);
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
    return refs;
  }

  private mergeScopeRefs(...sources: ScopeRef[][]): ScopeRef[] {
    const refs = new Map<string, ScopeRef>();
    for (const source of sources) {
      for (const ref of source) {
        const key = `${ref.scope}:${ref.wwuid}`;
        const existing = refs.get(key);
        if (!existing || (ref.signal_count ?? 0) > (existing.signal_count ?? 0)) {
          refs.set(key, ref);
        }
      }
    }
    return [...refs.values()];
  }
}
