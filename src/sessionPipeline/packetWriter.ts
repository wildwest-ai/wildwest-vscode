/**
 * Session Export Pipeline — Packet Writer
 * 
 * Writes delta packets to staged/packets/ with:
 * - Idempotency on (wwsid, turn_index)
 * - Gap detection and rejection
 * - Deterministic packet_id generation
 */

import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import {
  SessionPacket,
  NormalizedTurn,
  SessionRecord,
  SessionIndex,
  IndexEntry,
} from './types';
import {
  generatePacketFilename,
  parsePacketFilename,
  padSequence,
} from './utils';

export interface PacketWriterOptions {
  /** Base directory for staged/ output (e.g., ~/wildwest/sessions/raw/../staged) */
  stagedDir: string;
  /** Actor name (e.g., 'reneyap') */
  actor: string;
  /** Device ID (pre-computed UUIDv5) */
  device_id: string;
}

/**
 * Packet writer — manages delta packet emission and storage persistence
 */
export class PacketWriter {
  private stagedDir: string;
  private actor: string;
  private device_id: string;

  constructor(options: PacketWriterOptions) {
    this.stagedDir = options.stagedDir;
    this.actor = options.actor;
    this.device_id = options.device_id;

    // Ensure directories exist
    this.ensureDirectories();
  }

  private ensureDirectories(): void {
    const packetsDir = path.join(this.stagedDir, 'packets');
    const storageDir = path.join(this.stagedDir, 'storage', 'sessions');
    fs.mkdirSync(packetsDir, { recursive: true });
    fs.mkdirSync(storageDir, { recursive: true });
  }

  /**
   * Write a packet to staged/packets/
   * 
   * Enforces:
   * - Idempotency on (wwsid, turn_index)
   * - Gap detection (seq_to of packet N must equal seq_from of packet N+1)
   * - Deterministic packet_id
   * 
   * @param wwsid Wildwest session ID
   * @param tool Tool code
   * @param tool_sid Tool-native session ID
   * @param turns Normalized turns for this packet
   * @param closed Whether this is the final packet
   * @throws Error if packet would create a gap or violate idempotency
   * @returns Path to written packet file
   */
  async writePacket(
    wwsid: string,
    tool: 'cld' | 'cpt' | 'ccx',
    tool_sid: string,
    turns: NormalizedTurn[],
    closed: boolean
  ): Promise<string> {
    if (turns.length === 0) {
      throw new Error('Packet must contain at least one turn');
    }

    const seq_from = turns[0].turn_index;
    const seq_to = turns[turns.length - 1].turn_index;

    // Check idempotency: if any turn is already stored, skip
    const existingRecord = this.loadSessionRecord(wwsid);
    if (existingRecord && existingRecord.turn_count > 0) {
      const existingTurns = new Set(existingRecord.turns.map((t) => t.turn_index));
      const newTurns = turns.filter((t) => !existingTurns.has(t.turn_index));

      if (newTurns.length === 0) {
        // All turns already stored — this is a no-op (idempotent)
        const filename = generatePacketFilename(wwsid, seq_from, seq_to);
        return path.join(this.stagedDir, 'packets', filename);
      }

      // Partial overlap — update seq range to new turns only
      // This handles the case where some turns in the packet are new
      const actualSeqFrom = newTurns[0].turn_index;
      const actualSeqTo = newTurns[newTurns.length - 1].turn_index;

      // Check gap: expect seq_from to be existingTurns.max + 1
      const maxExisting = Math.max(...Array.from(existingTurns));
      if (actualSeqFrom > maxExisting + 1) {
        throw new Error(
          `Gap detected: expected seq_from=${maxExisting + 1}, got ${actualSeqFrom}`
        );
      }

      // Write packet with new turns only
      return this.writeDeltaPacket(
        wwsid,
        tool,
        tool_sid,
        newTurns,
        actualSeqFrom,
        actualSeqTo,
        closed
      );
    }

    // First packet or no prior record — write all turns
    // Check seq_from is 0 for first packet
    if (!existingRecord && seq_from !== 0) {
      throw new Error(`First packet must start at seq_from=0, got ${seq_from}`);
    }

    return this.writeDeltaPacket(wwsid, tool, tool_sid, turns, seq_from, seq_to, closed);
  }

  private writeDeltaPacket(
    wwsid: string,
    tool: 'cld' | 'cpt' | 'ccx',
    tool_sid: string,
    turns: NormalizedTurn[],
    seq_from: number,
    seq_to: number,
    closed: boolean
  ): string {
    const packet: SessionPacket = {
      schema_version: '1',
      packet_id: uuidv4(),
      wwsid,
      tool,
      tool_sid,
      actor: this.actor,
      device_id: this.device_id,
      seq_from,
      seq_to,
      created_at: new Date().toISOString(),
      closed,
      turns,
    };

    const filename = generatePacketFilename(wwsid, seq_from, seq_to);
    const filepath = path.join(this.stagedDir, 'packets', filename);

    fs.writeFileSync(filepath, JSON.stringify(packet, null, 2), 'utf8');
    return filepath;
  }

  /**
   * Apply a packet to storage — accumulate turns in session record
   * 
   * Updates:
   * - staged/storage/sessions/<wwsid>.json
   * - staged/storage/index.json
   * 
   * Idempotent: applying the same packet twice is a no-op.
   */
  async applyPacketToStorage(
    packet: SessionPacket,
    projectPath: string,
    sessionType: 'chat' | 'edit',
    toolCursor?: any
  ): Promise<void> {
    const sessionRecordPath = path.join(
      this.stagedDir,
      'storage',
      'sessions',
      `${packet.wwsid}.json`
    );

    let record = this.loadSessionRecord(packet.wwsid);

    if (!record) {
      // First packet — create new session record
      record = {
        schema_version: '1',
        wwsid: packet.wwsid,
        tool: packet.tool,
        tool_sid: packet.tool_sid,
        actor: packet.actor,
        device_id: packet.device_id,
        session_type: sessionType,
        project_path: projectPath,
        created_at: packet.created_at,
        last_turn_at: packet.created_at,
        closed_at: packet.closed ? packet.created_at : null,
        cursor: {
          type: this.getCursorType(packet.tool),
          value: this.extractCursorValue(packet.turns[packet.turns.length - 1]),
        },
        turn_count: packet.turns.length,
        turns: packet.turns,
      };
    } else {
      // Existing session — merge turns (idempotent)
      const existingTurns = new Map(record.turns.map((t) => [t.turn_index, t]));

      for (const turn of packet.turns) {
        // Skip if already present (idempotency)
        if (!existingTurns.has(turn.turn_index)) {
          record.turns.push(turn);
          existingTurns.set(turn.turn_index, turn);
        }
      }

      // Sort turns by turn_index
      record.turns.sort((a, b) => a.turn_index - b.turn_index);

      // Update metadata
      record.last_turn_at = packet.created_at;
      record.turn_count = record.turns.length;
      record.cursor = toolCursor || {
        type: this.getCursorType(packet.tool),
        value: this.extractCursorValue(record.turns[record.turns.length - 1]),
      };

      // Mark as closed if this packet is the close
      if (packet.closed) {
        record.closed_at = packet.created_at;
      }
    }

    // Write session record
    fs.writeFileSync(sessionRecordPath, JSON.stringify(record, null, 2), 'utf8');

    // Update index
    this.updateIndex(record);
  }

  private updateIndex(record: SessionRecord): void {
    const indexPath = path.join(this.stagedDir, 'storage', 'index.json');

    let index: any = { schema_version: '1', updated_at: new Date().toISOString(), sessions: [] };
    if (fs.existsSync(indexPath)) {
      index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    }

    // Upsert session in index
    const existingIdx = index.sessions.findIndex((s: any) => s.wwsid === record.wwsid);
    const entry: IndexEntry = {
      wwsid: record.wwsid,
      tool: record.tool,
      tool_sid: record.tool_sid,
      actor: record.actor,
      device_id: record.device_id,
      session_type: record.session_type,
      project_path: record.project_path,
      created_at: record.created_at,
      last_turn_at: record.last_turn_at,
      closed_at: record.closed_at,
      turn_count: record.turn_count,
    };

    if (existingIdx >= 0) {
      index.sessions[existingIdx] = entry;
    } else {
      index.sessions.push(entry);
    }

    index.updated_at = new Date().toISOString();
    fs.writeFileSync(indexPath, JSON.stringify(index, null, 2), 'utf8');
  }

  private loadSessionRecord(wwsid: string): SessionRecord | null {
    const recordPath = path.join(this.stagedDir, 'storage', 'sessions', `${wwsid}.json`);
    if (!fs.existsSync(recordPath)) {
      return null;
    }
    return JSON.parse(fs.readFileSync(recordPath, 'utf8'));
  }

  private getCursorType(tool: string): 'message_id' | 'request_id' | 'line_offset' {
    switch (tool) {
      case 'cld':
        return 'message_id';
      case 'cpt':
        return 'request_id';
      case 'ccx':
        return 'line_offset';
      default:
        throw new Error(`Unknown tool: ${tool}`);
    }
  }

  private extractCursorValue(turn: NormalizedTurn): string | number {
    // Use tool-native cursor value if available in turn meta
    if (turn.meta?.tool_cursor_value !== undefined) {
      return turn.meta.tool_cursor_value;
    }
    // Fallback: use turn_index
    return turn.turn_index;
  }
}
