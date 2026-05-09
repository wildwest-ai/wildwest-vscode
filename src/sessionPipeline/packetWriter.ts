/**
 * Session Export Pipeline — Packet Writer
 * 
 * Writes delta packets to staged/packets/ with:
 * - Idempotency on (wwuid, turn_index)
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
  IndexEntry,
  Cursor,
  ScopeRef,
  WildWestScope,
} from './types';
import { generatePacketFilename } from './utils';

export interface PacketWriterOptions {
  /** Base directory for staged/ output (e.g., ~/wildwest/sessions/raw/../staged) */
  stagedDir: string;
  /** Git username of session author (e.g., 'reneyap') */
  author: string;
  /** Device ID (pre-computed UUIDv5) */
  device_id: string;
}

/**
 * Packet writer — manages delta packet emission and storage persistence
 */
export class PacketWriter {
  private stagedDir: string;
  private author: string;
  private device_id: string;

  constructor(options: PacketWriterOptions) {
    this.stagedDir = options.stagedDir;
    this.author = options.author;
    this.device_id = options.device_id;

    // Ensure directories exist
    this.ensureDirectories();
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
   * - Idempotency on (wwuid, turn_index)
   * - Gap detection (seq_to of packet N must equal seq_from of packet N+1)
   * - Deterministic packet_id
   *
   * @param wwuid Wildwest universal ID for this session
   * @param tool Tool code
   * @param tool_sid Tool-native session ID
   * @param turns Normalized turns for this packet
   * @param closed Whether this is the final packet
   * @throws Error if packet would create a gap or violate idempotency
   * @returns Path to written packet file
   */
  async writePacket(
    wwuid: string,
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
    const existingRecord = this.loadSessionRecord(wwuid);
    if (existingRecord && existingRecord.turn_count > 0) {
      const existingTurns = new Set(existingRecord.turns.map((t) => t.turn_index));
      const newTurns = turns.filter((t) => !existingTurns.has(t.turn_index));

      if (newTurns.length === 0) {
        // All turns already stored — this is a no-op (idempotent)
        const filename = generatePacketFilename(wwuid, seq_from, seq_to);
        return path.join(this.stagedDir, 'packets', filename);
      }

      // Partial overlap — update seq range to new turns only
      const actualSeqFrom = newTurns[0].turn_index;
      const actualSeqTo = newTurns[newTurns.length - 1].turn_index;

      const maxExisting = Math.max(...Array.from(existingTurns));
      if (actualSeqFrom > maxExisting + 1) {
        throw new Error(
          `Gap detected: expected seq_from=${maxExisting + 1}, got ${actualSeqFrom}`
        );
      }

      return this.writeDeltaPacket(
        wwuid,
        tool,
        tool_sid,
        newTurns,
        actualSeqFrom,
        actualSeqTo,
        closed
      );
    }

    if (!existingRecord && seq_from !== 0) {
      throw new Error(`First packet must start at seq_from=0, got ${seq_from}`);
    }

    return this.writeDeltaPacket(wwuid, tool, tool_sid, turns, seq_from, seq_to, closed);
  }

  private writeDeltaPacket(
    wwuid: string,
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
      wwuid,
      wwuid_type: 'session',
      tool,
      tool_sid,
      author: this.author,
      device_id: this.device_id,
      seq_from,
      seq_to,
      created_at: new Date().toISOString(),
      closed,
      turns,
    };

    this.ensureDirectories();
    const filename = generatePacketFilename(wwuid, seq_from, seq_to);
    const filepath = path.join(this.stagedDir, 'packets', filename);

    fs.writeFileSync(filepath, JSON.stringify(packet, null, 2), 'utf8');
    return filepath;
  }

  /**
   * Apply a packet to storage — accumulate turns in session record
   * 
   * Updates:
   * - staged/storage/sessions/<wwuid>.json
   * - staged/storage/index.json
   * 
   * Idempotent: applying the same packet twice is a no-op.
   */
  async applyPacketToStorage(
    packet: SessionPacket,
    projectPath: string,
    sessionType: 'chat' | 'edit',
    toolCursor?: unknown,
    sessionCreatedAt?: string,
    recorderWwuid?: string,
    recorderScope?: WildWestScope,
    workspaceWwuids?: string[],
    scopeRefs?: ScopeRef[],
  ): Promise<void> {
    this.ensureDirectories();
    const sessionRecordPath = path.join(
      this.stagedDir,
      'storage',
      'sessions',
      `${packet.wwuid}.json`
    );

    const lastTurnTimestamp = packet.turns[packet.turns.length - 1].timestamp;
    const firstTurnTimestamp = packet.turns[0].timestamp;

    let record = this.loadSessionRecord(packet.wwuid);

    if (!record) {
      record = {
        schema_version: '1',
        wwuid: packet.wwuid,
        wwuid_type: 'session',
        tool: packet.tool,
        tool_sid: packet.tool_sid,
        author: packet.author,
        device_id: packet.device_id,
        session_type: sessionType,
        recorder_wwuid: recorderWwuid ?? '',
        recorder_scope: recorderScope ?? '',
        workspace_wwuids: workspaceWwuids ?? (recorderWwuid ? [recorderWwuid] : []),
        scope_refs: scopeRefs ?? [],
        project_path: projectPath,
        created_at: sessionCreatedAt ?? firstTurnTimestamp,
        last_turn_at: lastTurnTimestamp,
        closed_at: packet.closed ? lastTurnTimestamp : null,
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
      record.last_turn_at = lastTurnTimestamp;
      record.turn_count = record.turns.length;
      record.workspace_wwuids = this.mergeWwuids(record.workspace_wwuids, workspaceWwuids);
      record.scope_refs = this.mergeScopeRefs(record.scope_refs, scopeRefs);
      if (!record.recorder_wwuid && recorderWwuid) {
        record.recorder_wwuid = recorderWwuid;
      }
      if (!record.recorder_scope && recorderScope) {
        record.recorder_scope = recorderScope;
      }
      if (!record.project_path && projectPath) {
        record.project_path = projectPath;
      }
      record.cursor = (toolCursor as Cursor | undefined) || {
        type: this.getCursorType(packet.tool),
        value: this.extractCursorValue(record.turns[record.turns.length - 1]),
      };

      // Mark as closed if this packet is the close
      if (packet.closed) {
        record.closed_at = lastTurnTimestamp;
      }
    }

    // Write session record
    fs.writeFileSync(sessionRecordPath, JSON.stringify(record, null, 2), 'utf8');

    // Update index
    this.updateIndex(record, workspaceWwuids);
  }

  patchIndexEntry(
    wwuid: string,
    projectPath: string,
    recorderWwuid: string,
    recorderScope: WildWestScope | '',
    workspaceWwuids: string[],
    scopeRefs: ScopeRef[],
  ): void {
    const indexPath = path.join(this.stagedDir, 'storage', 'index.json');
    if (!fs.existsSync(indexPath)) return;
    try {
      const index = JSON.parse(fs.readFileSync(indexPath, 'utf8')) as { sessions: Record<string, unknown>[] };
      const entry = index.sessions.find((s) => s['wwuid'] === wwuid);
      if (entry) {
        let dirty = false;
        if (!entry['recorder_wwuid'] && recorderWwuid) {
          entry['recorder_wwuid'] = recorderWwuid;
          dirty = true;
        }
        if (!entry['recorder_scope'] && recorderScope) {
          entry['recorder_scope'] = recorderScope;
          dirty = true;
        }
        if (!entry['project_path'] && projectPath) {
          entry['project_path'] = projectPath;
          dirty = true;
        }
        const existingWwuids = Array.isArray(entry['workspace_wwuids'])
          ? entry['workspace_wwuids'] as string[]
          : [];
        const mergedWwuids = this.mergeWwuids(existingWwuids, workspaceWwuids);
        if (mergedWwuids.length !== existingWwuids.length) {
          entry['workspace_wwuids'] = mergedWwuids;
          dirty = true;
        }
        const existingScopeRefs = Array.isArray(entry['scope_refs'])
          ? entry['scope_refs'] as ScopeRef[]
          : [];
        const mergedScopeRefs = this.mergeScopeRefs(existingScopeRefs, scopeRefs);
        if (mergedScopeRefs.length !== existingScopeRefs.length) {
          entry['scope_refs'] = mergedScopeRefs;
          dirty = true;
        }
        if (!dirty) return;
        fs.writeFileSync(indexPath, JSON.stringify(index, null, 2), 'utf8');
      }
    } catch { /* skip */ }
  }

  private updateIndex(record: SessionRecord, workspaceWwuids?: string[]): void {
    const indexPath = path.join(this.stagedDir, 'storage', 'index.json');

    let index: { schema_version: string; updated_at: string; sessions: IndexEntry[] } = { schema_version: '1', updated_at: new Date().toISOString(), sessions: [] };
    if (fs.existsSync(indexPath)) {
      index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    }

    // Upsert session in index
    const existingIdx = index.sessions.findIndex((s: IndexEntry) => s.wwuid === record.wwuid);
    const workspaceWwuidsForIndex = this.mergeWwuids(
      record.workspace_wwuids,
      workspaceWwuids,
      record.recorder_wwuid ? [record.recorder_wwuid] : [],
    );
    const scopeRefsForIndex = this.mergeScopeRefs(record.scope_refs);
    const entry: IndexEntry = {
      wwuid: record.wwuid,
      wwuid_type: 'session',
      tool: record.tool,
      tool_sid: record.tool_sid,
      author: record.author,
      device_id: record.device_id,
      session_type: record.session_type,
      recorder_wwuid: record.recorder_wwuid ?? '',
      recorder_scope: record.recorder_scope ?? '',
      workspace_wwuids: workspaceWwuidsForIndex,
      scope_refs: scopeRefsForIndex,
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

  private loadSessionRecord(wwuid: string): SessionRecord | null {
    const recordPath = path.join(this.stagedDir, 'storage', 'sessions', `${wwuid}.json`);
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
