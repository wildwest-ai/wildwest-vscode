/**
 * wwMCP standalone server — stdio entry point for Claude Code and other MCP clients.
 *
 * Runs without VSCode. Context is resolved from env vars:
 *   WW_ROOT        — town/county root path (default: process.cwd())
 *   WW_WORLD_ROOT  — territory root (default: ~/wildwest)
 *   WW_COUNTIES_DIR — counties subdirectory name (default: counties)
 *   WW_IDENTITY    — actor identity string (default: "")
 */

import * as fs from 'fs';
import * as path from 'path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { checkActorAccess } from './wwMCPAuth';
import {
  toolStatus,
  toolInbox,
  toolBoard,
  toolTelegraphCheck,
  toolDraftWire,
  toolSendWire,
  toolRetryWire,
} from './wwMCPTools';
import {
  TOOL_STATUS,
  TOOL_INBOX,
  TOOL_BOARD,
  TOOL_TELEGRAPH_CHECK,
  TOOL_DRAFT_WIRE,
  TOOL_SEND_WIRE,
  TOOL_RETRY_WIRE,
  type MCPScopeContext,
  type InboxInput,
  type BoardInput,
  type DraftWireInput,
  type SendWireInput,
  type RetryWireInput,
} from './types';

// ── Context resolution ────────────────────────────────────────────────────

const rootPath = process.env['WW_ROOT'] ?? process.cwd();
const worldRoot = (process.env['WW_WORLD_ROOT'] ?? '~/wildwest').replace(
  /^~/,
  process.env['HOME'] ?? '',
);
const countiesDir = process.env['WW_COUNTIES_DIR'] ?? 'counties';
const identity = process.env['WW_IDENTITY'] ?? '';

function detectScope(root: string): 'town' | 'county' | 'territory' | null {
  try {
    const reg = JSON.parse(
      fs.readFileSync(path.join(root, '.wildwest', 'registry.json'), 'utf8'),
    ) as Record<string, unknown>;
    const s = reg['scope'];
    if (s === 'town' || s === 'county' || s === 'territory') return s;
  } catch { /* unreadable or missing */ }
  return null;
}

const scope = detectScope(rootPath);
if (!scope) {
  process.stderr.write(
    `[wwmcp-standalone] ERROR: .wildwest/registry.json missing or has no valid scope at ${rootPath}\n`,
  );
  process.exit(1);
}

const ctx: MCPScopeContext = { rootPath, scope, worldRoot, countiesDir, identity };

// ── Stub output channel (replaces vscode.OutputChannel) ──────────────────

const log = { appendLine: (msg: string) => process.stderr.write(msg + '\n') };

// ── Server ────────────────────────────────────────────────────────────────

const server = new Server(
  { name: 'wwmcp', version: '1.0.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: TOOL_STATUS,
      description: 'Return town/county identity, heartbeat state, and last beat timestamp.',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: TOOL_INBOX,
      description: 'List unprocessed wires from the identity inbox (scope-filtered).',
      inputSchema: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Max wires to return (default 20)' },
        },
      },
    },
    {
      name: TOOL_BOARD,
      description: 'List tracked branches from .wildwest/board/branches/.',
      inputSchema: {
        type: 'object',
        properties: {
          state: {
            type: 'string',
            enum: ['open', 'all'],
            description: 'Filter by branch state (default: open)',
          },
        },
      },
    },
    {
      name: TOOL_TELEGRAPH_CHECK,
      description: 'Return wire counts for inbox, outbox, history, and dead-letter.',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: TOOL_DRAFT_WIRE,
      description: 'Create a draft wire in the local workspace .wildwest/telegraph/flat directory for review before dispatch.',
      inputSchema: {
        type: 'object',
        properties: {
          from: { type: 'string', description: 'Sender identity in Role[alias] format (e.g. TM[wildwest-vscode])' },
          to: { type: 'string', description: 'Recipient role in Role[alias] format' },
          subject: { type: 'string', description: 'Kebab-case wire subject slug' },
          body: { type: 'string', description: 'Wire body text' },
          type: { type: 'string', description: 'Wire type (default: status-update)' },
          re: { type: 'string', description: 'Reference wire wwuid' },
        },
        required: ['from', 'to', 'subject', 'body'],
      },
    },
    {
      name: TOOL_SEND_WIRE,
      description: 'Create and immediately dispatch a wire to territory and local outbox.',
      inputSchema: {
        type: 'object',
        properties: {
          from: { type: 'string', description: 'Sender identity in Role[alias] format (e.g. TM[wildwest-vscode])' },
          to: { type: 'string', description: 'Recipient role in Role[alias] format' },
          subject: { type: 'string', description: 'Kebab-case wire subject slug' },
          body: { type: 'string', description: 'Wire body text' },
          type: { type: 'string', description: 'Wire type (default: status-update)' },
          re: { type: 'string', description: 'Reference wire wwuid' },
        },
        required: ['from', 'to', 'subject', 'body'],
      },
    },
    {
      name: TOOL_RETRY_WIRE,
      description: 'Restore a failed !{wwuid}.json wire to pending and trigger immediate delivery.',
      inputSchema: {
        type: 'object',
        properties: {
          wwuid: { type: 'string', description: 'Failed wire wwuid to retry' },
        },
        required: ['wwuid'],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const auth = checkActorAccess(ctx.rootPath, log as never);
  if (!auth.allowed) {
    return { content: [{ type: 'text', text: `Access denied: ${auth.reason}` }], isError: true };
  }

  const args = (request.params.arguments ?? {}) as Record<string, unknown>;

  try {
    switch (request.params.name) {
      case TOOL_STATUS:
        return { content: [{ type: 'text', text: JSON.stringify(toolStatus(ctx), null, 2) }] };
      case TOOL_INBOX:
        return { content: [{ type: 'text', text: JSON.stringify(toolInbox(ctx, args as InboxInput), null, 2) }] };
      case TOOL_BOARD:
        return { content: [{ type: 'text', text: JSON.stringify(toolBoard(ctx, args as BoardInput), null, 2) }] };
      case TOOL_TELEGRAPH_CHECK:
        return { content: [{ type: 'text', text: JSON.stringify(toolTelegraphCheck(ctx), null, 2) }] };
      case TOOL_DRAFT_WIRE:
        return { content: [{ type: 'text', text: JSON.stringify(toolDraftWire(ctx, args as unknown as DraftWireInput), null, 2) }] };
      case TOOL_SEND_WIRE:
        return { content: [{ type: 'text', text: JSON.stringify(toolSendWire(ctx, args as unknown as SendWireInput), null, 2) }] };
      case TOOL_RETRY_WIRE:
        return { content: [{ type: 'text', text: JSON.stringify(toolRetryWire(ctx, args as unknown as RetryWireInput), null, 2) }] };
      default:
        return { content: [{ type: 'text', text: `Unknown tool: ${request.params.name}` }], isError: true };
    }
  } catch (err) {
    return { content: [{ type: 'text', text: `Error: ${String(err)}` }], isError: true };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(`[wwmcp-standalone] started — root: ${rootPath}, scope: ${scope}\n`);
}

main().catch((err) => {
  process.stderr.write(`[wwmcp-standalone] fatal: ${String(err)}\n`);
  process.exit(1);
});
