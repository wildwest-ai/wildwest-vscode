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
import { SessionExportPipeline } from './orchestrator';

export interface PipelineAdapterOptions {
  sessionsDir: string;
  author: string;
  projectPath?: string;
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

export class PipelineAdapter {
  private pipeline: SessionExportPipeline;
  private lastProcessedMtime: Map<string, number> = new Map();

  constructor(options: PipelineAdapterOptions) {
    this.pipeline = new SessionExportPipeline({
      sessionsDir: options.sessionsDir,
      author: options.author,
      projectPath: options.projectPath,
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

        // ccx: patch project_path from raw session_meta.payload.cwd
        if (record['tool'] === 'ccx') {
          // tool_sid may already include extension (legacy records) or may be bare
          const sid = record['tool_sid'] as string;
          const rawPath = path.join(rawDir, 'chatgpt-codex', sid.endsWith('.jsonl') ? sid : `${sid}.jsonl`);
          const rawPathJson = path.join(rawDir, 'chatgpt-codex', sid.endsWith('.json') ? sid : `${sid}.json`);
          const rp = fs.existsSync(rawPath) ? rawPath : fs.existsSync(rawPathJson) ? rawPathJson : null;
          if (rp) {
            const content = fs.readFileSync(rp, 'utf8');
            const metaLine = content.split('\n').find((l) => {
              try { return JSON.parse(l)['type'] === 'session_meta'; } catch { return false; }
            });
            if (metaLine) {
              const meta = JSON.parse(metaLine) as Record<string, unknown>;
              const cwd = ((meta['payload'] as Record<string, unknown> | undefined)?.['cwd'] as string | undefined);
              if (cwd) { record['project_path'] = cwd; dirty = true; }
            }
          }
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
