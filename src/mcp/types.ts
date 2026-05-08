import { WildWestScope } from '../HeartbeatMonitor';

// ── MCP tool names ─────────────────────────────────────────────────────────

export const TOOL_STATUS = 'wildwest_status';
export const TOOL_INBOX = 'wildwest_inbox';
export const TOOL_BOARD = 'wildwest_board';
export const TOOL_TELEGRAPH_CHECK = 'wildwest_telegraph_check';

// ── Scope context ──────────────────────────────────────────────────────────

export interface MCPScopeContext {
  /** Root path of the connecting workspace (town, county, etc.) */
  rootPath: string;
  scope: WildWestScope;
  worldRoot: string;
  countiesDir: string;
}

// ── Tool input/output shapes ───────────────────────────────────────────────

export interface StatusOutput {
  alias: string;
  scope: WildWestScope;
  wwuid: string;
  lastBeat: string;
  state: string;
}

export interface MemoSummary {
  filename: string;
  subject: string;
  from: string;
  date: string;
}

export interface InboxInput {
  limit?: number;
}

export interface InboxOutput {
  memos: MemoSummary[];
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

export interface TelegraphCheckOutput {
  inbox: number;
  outbox: number;
  history: number;
  deadLetter: number;
}
