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
            const tool_sid = path.basename(file, '.json');

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
}
