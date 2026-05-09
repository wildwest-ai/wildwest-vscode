/**
 * Session Export Pipeline — Normalized Schema Types
 * 
 * Defines the common schema for all AI tool sessions (cpt, cld, ccx)
 * after normalization. Implements the spec from:
 * .wildwest/board/branches/active/feat/session-export-pipeline/spec.md
 */

/**
 * Part kinds — atomic content units in a turn
 */
export type PartKind = 'text' | 'thinking' | 'tool_use' | 'tool_result';

export interface ContentPart {
  kind: PartKind;
  content: string;
  thinking_id?: string; // Present for thinking parts
}

/**
 * Per-turn metadata — optional, tool-specific insights
 */
export interface TurnMeta {
  model?: string; // e.g., 'claude-sonnet-4-6', 'gpt-5.2-codex'
  elapsed_ms?: number;
  completion_tokens?: number;
  tool_cursor_value?: string | number; // Tool-native cursor for this turn (requestId, message_id, line offset, etc.)
  [key: string]: unknown;
}

/**
 * Normalized turn — the canonical record of a conversation exchange
 */
export interface NormalizedTurn {
  turn_index: number; // Zero-based, monotonically increasing
  role: 'user' | 'assistant';
  content: string; // Pre-joined text content for convenience
  parts: ContentPart[];
  meta: TurnMeta;
  timestamp: string; // ISO 8601 UTC
}

/**
 * Cursor — tracks position in tool-native session to enable delta export
 */
export type CursorType = 'message_id' | 'request_id' | 'line_offset';

export interface Cursor {
  type: CursorType;
  value: string | number; // message.id, requestId, or line number
}

export type WildWestScope = 'town' | 'county' | 'territory';

export interface ScopeRef {
  scope: WildWestScope;
  wwuid: string;
  alias: string;
  path: string;
  signal_count?: number;
}

/**
 * Packet — delta export unit containing a sequence of turns
 * 
 * File: staged/packets/<wwuid>-<seq_from_padded>-<seq_to_padded>.json
 */
export interface SessionPacket {
  schema_version: '1';
  packet_id: string; // UUIDv4
  wwuid: string; // UUIDv5 — generateWwuid('session', tool, tool_sid)
  wwuid_type: 'session';
  tool: 'cld' | 'cpt' | 'ccx';
  tool_sid: string; // Tool-native session ID
  author: string; // Git username of session author (e.g., 'reneyap')
  device_id: string; // UUIDv5 (deterministic from hostname)
  seq_from: number; // First turn_index in this packet
  seq_to: number; // Last turn_index in this packet
  created_at: string; // ISO 8601 UTC
  closed: boolean; // true if this is the final packet for the session
  turns: NormalizedTurn[];
}

/**
 * Session Record — accumulated full history
 * 
 * File: staged/storage/sessions/<wwuid>.json
 */
export interface SessionRecord {
  schema_version: '1';
  wwuid: string;
  wwuid_type: 'session';
  tool: 'cld' | 'cpt' | 'ccx';
  tool_sid: string;
  author: string;
  device_id: string;
  session_type: 'chat' | 'edit'; // 'edit' reserved for copilot-edits (future)
  recorder_wwuid: string; // wwuid of the town registry that recorded this session
  recorder_scope: WildWestScope | '';
  workspace_wwuids: string[]; // primary scope lineage wwuid values
  scope_refs: ScopeRef[]; // absolute scope identities used for filtering
  project_path: string;
  created_at: string; // ISO 8601 UTC
  last_turn_at: string; // ISO 8601 UTC
  closed_at: string | null;
  cursor: Cursor;
  turn_count: number;
  turns: NormalizedTurn[];
}

/**
 * Index Entry — fast lookup without loading full session
 * 
 * Stored in staged/storage/index.json under sessions[]
 */
export interface IndexEntry {
  wwuid: string;
  wwuid_type: 'session';
  tool: 'cld' | 'cpt' | 'ccx';
  tool_sid: string;
  author: string;
  device_id: string;
  session_type: 'chat' | 'edit';
  recorder_wwuid: string; // primary attribution (workspace with most signals)
  recorder_scope: WildWestScope | '';
  workspace_wwuids: string[]; // primary scope lineage wwuid values
  scope_refs: ScopeRef[]; // absolute scope identities used for filtering
  project_path: string;
  created_at: string; // ISO 8601 UTC
  last_turn_at: string; // ISO 8601 UTC
  closed_at: string | null;
  turn_count: number;
}

/**
 * Index — manifest of all sessions on this device
 * 
 * File: staged/storage/index.json
 */
export interface SessionIndex {
  schema_version: '1';
  updated_at: string; // ISO 8601 UTC
  sessions: IndexEntry[];
}
