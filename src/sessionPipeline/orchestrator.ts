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
import { SessionPacket, NormalizedTurn } from './types';
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

/**
 * Main pipeline orchestrator
 */
export class SessionExportPipeline {
  private sessionsDir: string;
  private author: string;
  private projectPath: string;
  private stagedDir: string;
  private packetWriter: PacketWriter;
  private device_id: string;
  private privacyMode: boolean;
  private homeDir: string;

  constructor(options: PipelineOptions) {
    this.sessionsDir = options.sessionsDir;
    this.author = options.author;
    this.projectPath = options.projectPath || '';
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

    // 4. Check cursor to determine delta
    const newTurns = this.filterNewTurns(wwuid, filteredTurns);

    if (newTurns.length === 0 && !closed) {
      // No new turns and not closed — skip packet
      return;
    }

    // 5. Write packet
    const turnsForPacket = newTurns.length > 0 ? newTurns : filteredTurns;
    try {
      await this.packetWriter.writePacket(wwuid, tool, tool_sid, turnsForPacket, closed);
    } catch (error) {
      throw new Error(`Packet write failed: ${error}`);
    }

    // 6. Apply to storage
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
        metadata.project_path || this.projectPath,
        metadata.session_type,
        {
          type: getCursorType(tool),
          value: turnsForPacket[turnsForPacket.length - 1].meta?.tool_cursor_value || turnsForPacket[turnsForPacket.length - 1].turn_index,
        }
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
}
