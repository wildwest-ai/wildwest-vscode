/**
 * Session Export Pipeline — SessionExporter Adapter
 * 
 * Bridges the existing sessionExporter polling loop with the new pipeline.
 * 
 * Responsibilities:
 * - Detect when a session has new turns (via mtime check)
 * - Trigger pipeline export
 * - Handle session close events
 * - Manage packet emission timing
 */

import * as fs from 'fs';
import * as path from 'path';
import { AttributionResult, SessionExportPipeline } from './orchestrator';
import { getTransformer } from './transformers';
import { ScopeRef } from './types';

export interface PipelineAdapterOptions {
  sessionsDir: string;
  author: string;
  projectPath?: string;
  recorderWwuid?: string;
  privacyMode?: boolean;
  homeDir?: string;
}

/**
 * Maps tool codes to raw/ subdirectories
 */
const TOOL_RAW_DIRS: Record<string, string> = {
  cpt: 'github-copilot',
  cld: 'claude-code',
  ccx: 'chatgpt-codex',
};

type SessionTool = 'cld' | 'cpt' | 'ccx';

export class PipelineAdapter {
  private pipeline: SessionExportPipeline;
  private lastProcessedMtime: Map<string, number> = new Map();
  private attributionMigrationChecked = false;

  constructor(options: PipelineAdapterOptions) {
    this.pipeline = new SessionExportPipeline({
      sessionsDir: options.sessionsDir,
      author: options.author,
      projectPath: options.projectPath,
      recorderWwuid: options.recorderWwuid,
      privacyMode: options.privacyMode ?? false,
      homeDir: options.homeDir,
    });
  }

  /**
   * Process all raw sessions — emit new packets for changed sessions
   * 
   * Called from sessionExporter's polling loop when activity is detected.
   * Returns true if any packets were written.
   */
  async processRawSessions(): Promise<boolean> {
    let anyPacketsWritten = false;
    const rawDir = path.join(this.pipeline.getStagedDir(), '..', 'raw');

    if (!fs.existsSync(rawDir)) {
      return false;
    }

    // If storage index is gone, rebuild it from existing session records first.
    // This avoids filterNewTurns skipping sessions that already have records,
    // while also patching any stale project_path values (e.g. ccx cwd fix).
    const indexPath = path.join(this.pipeline.getStagedDir(), 'storage', 'index.json');
    if (!fs.existsSync(indexPath)) {
      this.rebuildIndexFromRecords();
    } else {
      this.rebuildIndexIfAttributionMigrationNeeded(indexPath);
    }

    for (const toolRawName of Object.values(TOOL_RAW_DIRS)) {
      const toolDir = path.join(rawDir, toolRawName);
      if (!fs.existsSync(toolDir)) {
        continue;
      }

      const files = fs.readdirSync(toolDir);
      for (const file of files) {
        const filepath = path.join(toolDir, file);
        const stats = fs.statSync(filepath);
        const mtime = stats.mtimeMs;
        const key = filepath;

        // Check if this file has been updated since we last processed it
        const lastMtime = this.lastProcessedMtime.get(key);
        if (!lastMtime || mtime > lastMtime) {
          try {
            // Determine tool from directory name
            const tool = this.getTool(toolRawName);
            // Strip the appropriate extension per tool (.jsonl for ccx/cld, .json for cpt)
            const ext = file.endsWith('.jsonl') ? '.jsonl' : '.json';
            const tool_sid = path.basename(file, ext);

            // Export to pipeline
            await this.pipeline.exportSession(
              {
                tool,
                tool_sid,
                rawPath: filepath,
              },
              false // not closed yet
            );

            this.lastProcessedMtime.set(key, mtime);
            anyPacketsWritten = true;
          } catch (error) {
            console.error(`Pipeline export failed for ${filepath}:`, error);
          }
        }
      }
    }

    return anyPacketsWritten;
  }

  /**
   * Close a session — emit final packet with closed: true
   * 
   * Called when a session is detected as closed (e.g., chat window closed,
   * or session file marked with close timestamp).
   */
  async closeSession(tool: 'cld' | 'cpt' | 'ccx', tool_sid: string): Promise<void> {
    const toolRawName = TOOL_RAW_DIRS[tool];
    const rawPath = path.join(
      this.pipeline.getStagedDir(),
      '..',
      'raw',
      toolRawName,
      `${tool_sid}.json`
    );

    if (!fs.existsSync(rawPath)) {
      return;
    }

    try {
      await this.pipeline.exportSession(
        {
          tool,
          tool_sid,
          rawPath,
        },
        true // closed
      );

      // Clear from mtime tracking
      this.lastProcessedMtime.delete(rawPath);
    } catch (error) {
      console.error(`Pipeline close failed for ${tool}:${tool_sid}:`, error);
    }
  }

  /**
   * Get tool code from raw directory name
   */
  private getTool(toolRawName: string): 'cld' | 'cpt' | 'ccx' {
    for (const [tool, dir] of Object.entries(TOOL_RAW_DIRS)) {
      if (dir === toolRawName) {
        return tool as 'cld' | 'cpt' | 'ccx';
      }
    }
    throw new Error(`Unknown tool directory: ${toolRawName}`);
  }

  /**
   * Get index of sessions currently in storage
   */
  async getStoredSessions(): Promise<Array<{ wwuid: string; tool: string; turn_count: number }>> {
    const indexPath = path.join(this.pipeline.getStagedDir(), 'storage', 'index.json');
    if (!fs.existsSync(indexPath)) {
      return [];
    }
    const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    return index.sessions || [];
  }

  /**
   * Get author
   */
  getAuthor(): string {
    return this.pipeline.getAuthor();
  }

  /**
   * Get staged directory
   */
  getStagedDir(): string {
    return this.pipeline.getStagedDir();
  }

  private mergeWwuids(...sources: Array<string[] | undefined>): string[] {
    const ids = new Set<string>();
    for (const source of sources) {
      for (const id of source ?? []) {
        if (id) ids.add(id);
      }
    }
    return [...ids];
  }

  private mergeScopeRefs(...sources: Array<ScopeRef[] | undefined>): ScopeRef[] {
    const refs = new Map<string, ScopeRef>();
    for (const source of sources) {
      for (const ref of source ?? []) {
        if (!ref.wwuid || !ref.scope) continue;
        const key = `${ref.scope}:${ref.wwuid}`;
        const existing = refs.get(key);
        if (!existing || (ref.signal_count ?? 0) > (existing.signal_count ?? 0)) {
          refs.set(key, ref);
        }
      }
    }
    return [...refs.values()];
  }

  private findRawSessionPath(rawDir: string, tool: string, toolSid: string): string | null {
    const rawName = TOOL_RAW_DIRS[tool];
    if (!rawName) return null;
    const candidates = [
      path.join(rawDir, rawName, toolSid),
      path.join(rawDir, rawName, toolSid.endsWith('.json') ? toolSid : `${toolSid}.json`),
      path.join(rawDir, rawName, toolSid.endsWith('.jsonl') ? toolSid : `${toolSid}.jsonl`),
    ];
    return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
  }

  private resolveRawAttribution(rawDir: string, record: Record<string, unknown>): AttributionResult | null {
    const tool = record['tool'] as SessionTool | undefined;
    const toolSid = record['tool_sid'] as string | undefined;
    if (!tool || !toolSid || !TOOL_RAW_DIRS[tool]) return null;
    const rawPath = this.findRawSessionPath(rawDir, tool, toolSid);
    if (!rawPath) return null;
    try {
      const transformer = getTransformer(tool);
      const rawSession = transformer.parseRaw(fs.readFileSync(rawPath, 'utf8'));
      const metadata = transformer.getSessionMetadata(rawSession);
      return this.pipeline.resolveAttribution(tool, rawSession, metadata.project_path);
    } catch {
      return null;
    }
  }

  private needsCptAttributionMigration(session: Record<string, unknown>): boolean {
    const workspaceWwuids = Array.isArray(session['workspace_wwuids'])
      ? session['workspace_wwuids'] as string[]
      : [];
    const scopeRefs = Array.isArray(session['scope_refs'])
      ? session['scope_refs'] as ScopeRef[]
      : [];

    if (workspaceWwuids.length === 0 || scopeRefs.length === 0) return true;

    const scopedWwuids = new Set(scopeRefs.map((ref) => ref.wwuid).filter((wwuid) => wwuid !== ''));
    return workspaceWwuids.some((wwuid) => wwuid && !scopedWwuids.has(wwuid));
  }

  private rebuildIndexIfAttributionMigrationNeeded(indexPath: string): void {
    if (this.attributionMigrationChecked) return;
    this.attributionMigrationChecked = true;
    try {
      const index = JSON.parse(fs.readFileSync(indexPath, 'utf8')) as { sessions?: Record<string, unknown>[] };
      const needsMigration = (index.sessions ?? []).some((session) =>
        session['tool'] === 'cpt' && this.needsCptAttributionMigration(session)
      );
      if (needsMigration) {
        this.rebuildIndexFromRecords();
      }
    } catch { /* ignore corrupt index; normal processing will surface errors later */ }
  }

  /**
   * Rebuild index.json by scanning staged/storage/sessions/*.json.
   * - Patches cld project_path to the registry-backed workspace root (Claude Code
   *   records its .claude/ root, not the town directory).
   * - Patches ccx project_path from raw session_meta.payload.cwd.
   * Returns number of sessions indexed.
   */
  rebuildIndexFromRecords(): number {
    const stagedDir = this.pipeline.getStagedDir();
    const workspaceRoot = this.pipeline.getProjectPath();
    const recorderWwuid = this.pipeline.getRecorderWwuid();
    const sessionsDir = path.join(stagedDir, 'storage', 'sessions');
    const indexPath = path.join(stagedDir, 'storage', 'index.json');
    const rawDir = path.join(stagedDir, '..', 'raw');

    if (!fs.existsSync(sessionsDir)) return 0;

    const files = fs.readdirSync(sessionsDir).filter((f) => f.endsWith('.json'));
    const sessions: unknown[] = [];

    for (const file of files) {
      try {
        const record = JSON.parse(fs.readFileSync(path.join(sessionsDir, file), 'utf8')) as Record<string, unknown>;
        let dirty = false;

        const attribution = this.resolveRawAttribution(rawDir, record);
        if (attribution) {
          if (attribution.projectPath && record['project_path'] !== attribution.projectPath) {
            record['project_path'] = attribution.projectPath;
            dirty = true;
          }
          if (attribution.recorderWwuid && record['recorder_wwuid'] !== attribution.recorderWwuid) {
            record['recorder_wwuid'] = attribution.recorderWwuid;
            dirty = true;
          }
          if (attribution.recorderScope && record['recorder_scope'] !== attribution.recorderScope) {
            record['recorder_scope'] = attribution.recorderScope;
            dirty = true;
          }
          const existingWwuids = Array.isArray(record['workspace_wwuids'])
            ? record['workspace_wwuids'] as string[]
            : [];
          const nextWwuids = this.mergeWwuids(attribution.workspaceWwuids);
          if (JSON.stringify(nextWwuids) !== JSON.stringify(existingWwuids)) {
            record['workspace_wwuids'] = nextWwuids;
            dirty = true;
          }
          const existingScopeRefs = Array.isArray(record['scope_refs'])
            ? record['scope_refs'] as ScopeRef[]
            : [];
          const nextScopeRefs = this.mergeScopeRefs(attribution.scopeRefs);
          if (JSON.stringify(nextScopeRefs) !== JSON.stringify(existingScopeRefs)) {
            record['scope_refs'] = nextScopeRefs;
            dirty = true;
          }
        }

        // Stamp recorder_wwuid on records that lack it (migration for existing records).
        // Only stamp when project_path matches the current workspace — don't claim
        // sessions that belong to other workspaces.
        if (!record['recorder_wwuid'] && recorderWwuid && workspaceRoot
            && record['project_path'] === workspaceRoot) {
          record['recorder_wwuid'] = recorderWwuid;
          dirty = true;
        }

        // Persist any patches back to disk
        if (dirty) {
          fs.writeFileSync(path.join(sessionsDir, file), JSON.stringify(record, null, 2), 'utf8');
        }

        sessions.push({
          wwuid: record['wwuid'],
          wwuid_type: record['wwuid_type'] ?? 'session',
          tool: record['tool'],
          tool_sid: record['tool_sid'],
          author: record['author'],
          device_id: record['device_id'],
          session_type: record['session_type'],
          recorder_wwuid: record['recorder_wwuid'] ?? '',
          recorder_scope: record['recorder_scope'] ?? '',
          workspace_wwuids: this.mergeWwuids(
            Array.isArray(record['workspace_wwuids']) ? record['workspace_wwuids'] as string[] : [],
            record['recorder_wwuid'] ? [record['recorder_wwuid'] as string] : [],
          ),
          scope_refs: this.mergeScopeRefs(
            Array.isArray(record['scope_refs']) ? record['scope_refs'] as ScopeRef[] : [],
          ),
          project_path: record['project_path'],
          created_at: record['created_at'],
          last_turn_at: record['last_turn_at'],
          closed_at: record['closed_at'] ?? null,
          turn_count: record['turn_count'],
        });
      } catch { /* skip corrupt records */ }
    }

    const index = {
      schema_version: '1',
      updated_at: new Date().toISOString(),
      sessions,
    };
    fs.mkdirSync(path.dirname(indexPath), { recursive: true });
    fs.writeFileSync(indexPath, JSON.stringify(index, null, 2), 'utf8');

    return sessions.length;
  }
}
