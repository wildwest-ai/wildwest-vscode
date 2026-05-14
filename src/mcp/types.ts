import { WildWestScope } from '../HeartbeatMonitor';

// ── MCP tool names ─────────────────────────────────────────────────────────

export const TOOL_STATUS = 'wildwest_status';
export const TOOL_INBOX = 'wildwest_inbox';
export const TOOL_BOARD = 'wildwest_board';
export const TOOL_TELEGRAPH_CHECK = 'wildwest_telegraph_check';
export const TOOL_DRAFT_WIRE = 'wildwest_draft_wire';
export const TOOL_SEND_WIRE = 'wildwest_send_wire';
export const TOOL_RETRY_WIRE = 'wildwest_retry_wire';

// ── Scope context ──────────────────────────────────────────────────────────

export interface MCPScopeContext {
  /** Root path of the connecting workspace (town, county, etc.) */
  rootPath: string;
  /** Local workspace root for draft writes — defaults to rootPath */
  localRoot?: string;
  scope: WildWestScope;
  worldRoot: string;
  countiesDir: string;
  identity?: string;
}

// ── Tool input/output shapes ───────────────────────────────────────────────

export interface StatusOutput {
  alias: string;
  scope: WildWestScope;
  wwuid: string;
  lastBeat: string;
  state: string;
}

export interface WireSummary {
  filename: string;
  subject: string;
  from: string;
  date: string;
}

export interface InboxInput {
  limit?: number;
}

export interface InboxOutput {
  wires: WireSummary[];
  total: number;
}

export interface BoardInput {
  state?: 'open' | 'all';
}

export interface BranchSummary {
  branch: string;
  state: string;
  identity: string;
}

export interface BoardOutput {
  branches: BranchSummary[];
}

export interface DraftWireInput {
  from?: string;
  to: string;
  subject: string;
  body: string;
  type?: string;
  re?: string;
}

export interface SendWireInput {
  from?: string;
  to: string;
  subject: string;
  body: string;
  type?: string;
  re?: string;
}

export interface RetryWireInput {
  wwuid: string;
}

export interface WireWriteOutput {
  wwuid: string;
  filename: string;
  status: string;
  date: string;
  path: string;
}

export interface TelegraphCheckOutput {
  inbox: number;
  outbox: number;
  history: number;
  deadLetter: number;
}
