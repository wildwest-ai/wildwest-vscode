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
import { generateWwsid, generateDeviceId, getCursorType } from './utils';

export interface PipelineOptions {
  /**
   * Base directory for sessions (e.g., ~/wildwest/sessions)
   */
  sessionsDir: string;
  /**
   * Actor name (e.g., 'reneyap')
   */
  actor: string;
  /**
   * Optional project path (used for SessionRecord metadata)
   */
  projectPath?: string;
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
  private actor: string;
  private projectPath: string;
  private stagedDir: string;
  private packetWriter: PacketWriter;
  private device_id: string;

  constructor(options: PipelineOptions) {
    this.sessionsDir = options.sessionsDir;
    this.actor = options.actor;
    this.projectPath = options.projectPath || '';
    this.stagedDir = path.join(this.sessionsDir, 'staged');
    this.device_id = generateDeviceId();

    this.packetWriter = new PacketWriter({
      stagedDir: this.stagedDir,
      actor: this.actor,
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

    // 3. Generate wwsid
    const wwsid = generateWwsid(tool, tool_sid);

    // 4. Check cursor to determine delta
    const newTurns = this.filterNewTurns(wwsid, allTurns);

    if (newTurns.length === 0 && !closed) {
      // No new turns and not closed — skip packet
      return;
    }

    // 5. Write packet
    const turnsForPacket = newTurns.length > 0 ? newTurns : allTurns;
    try {
      await this.packetWriter.writePacket(wwsid, tool, tool_sid, turnsForPacket, closed);
    } catch (error) {
      throw new Error(`Packet write failed: ${error}`);
    }

    // 6. Apply to storage
    try {
      const packet: SessionPacket = {
        schema_version: '1',
        packet_id: uuidv4(),
        wwsid,
        tool,
        tool_sid,
        actor: this.actor,
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
  private filterNewTurns(wwsid: string, allTurns: NormalizedTurn[]): NormalizedTurn[] {
    const recordPath = path.join(
      this.stagedDir,
      'storage',
      'sessions',
      `${wwsid}.json`
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
   * Get actor
   */
  getActor(): string {
    return this.actor;
  }
}
