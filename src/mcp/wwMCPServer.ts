import * as vscode from 'vscode';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { HeartbeatMonitor } from '../HeartbeatMonitor';
import { checkActorAccess } from './wwMCPAuth';
import {
  toolBoard,
  toolDraftWire,
  toolInbox,
  toolRetryWire,
  toolSendWire,
  toolStatus,
  toolTelegraphCheck,
} from './wwMCPTools';
import {
  BoardInput,
  DraftWireInput,
  InboxInput,
  MCPScopeContext,
  RetryWireInput,
  SendWireInput,
  TOOL_BOARD,
  TOOL_DRAFT_WIRE,
  TOOL_INBOX,
  TOOL_RETRY_WIRE,
  TOOL_SEND_WIRE,
  TOOL_STATUS,
  TOOL_TELEGRAPH_CHECK,
} from './types';

export class wwMCPServer {
  private server: Server;
  private transport: StdioServerTransport | null = null;
  private ctx: MCPScopeContext | null = null;

  constructor(
    private readonly heartbeatMonitor: HeartbeatMonitor,
    private readonly outputChannel: vscode.OutputChannel,
  ) {
    this.server = new Server(
      { name: 'wildwest', version: '0.21.0' },
      { capabilities: { tools: {} } },
    );
    this.registerHandlers();
  }

  private resolveContext(): MCPScopeContext | null {
    const scope = this.heartbeatMonitor.detectScope();
    if (!scope) return null;

    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) return null;
    const rootPath = folders[0].uri.fsPath;

    const config = vscode.workspace.getConfiguration('wildwest');
    const worldRoot = (config.get<string>('worldRoot') ?? '~/wildwest').replace(
      /^~/,
      process.env.HOME ?? '',
    );
    const countiesDir = config.get<string>('countiesDir') ?? 'counties';
    const identity = config.get<string>('identity') ?? '';

    return { rootPath, localRoot: rootPath, scope, worldRoot, countiesDir, identity };
  }

  private registerHandlers(): void {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
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

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const ctx = this.resolveContext();
      if (!ctx) {
        return { content: [{ type: 'text', text: 'No Wild West scope found in current workspace.' }], isError: true };
      }

      const auth = checkActorAccess(ctx.rootPath, this.outputChannel);
      if (!auth.allowed) {
        return { content: [{ type: 'text', text: `Access denied: ${auth.reason}` }], isError: true };
      }

      const args = (request.params.arguments ?? {}) as Record<string, unknown>;

      try {
        switch (request.params.name) {
          case TOOL_STATUS: {
            const result = toolStatus(ctx);
            return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
          }
          case TOOL_INBOX: {
            const result = toolInbox(ctx, args as InboxInput);
            return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
          }
          case TOOL_BOARD: {
            const result = toolBoard(ctx, args as BoardInput);
            return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
          }
          case TOOL_TELEGRAPH_CHECK: {
            const result = toolTelegraphCheck(ctx);
            return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
          }
          case TOOL_DRAFT_WIRE: {
            const result = toolDraftWire(ctx, args as unknown as DraftWireInput);
            return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
          }
          case TOOL_SEND_WIRE: {
            const result = toolSendWire(ctx, args as unknown as SendWireInput);
            return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
          }
          case TOOL_RETRY_WIRE: {
            const result = toolRetryWire(ctx, args as unknown as RetryWireInput);
            this.heartbeatMonitor.deliverOutboxNow();
            return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
          }
          default:
            return { content: [{ type: 'text', text: `Unknown tool: ${request.params.name}` }], isError: true };
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.outputChannel.appendLine(`[wwMCP] tool error: ${msg}`);
        return { content: [{ type: 'text', text: `Tool error: ${msg}` }], isError: true };
      }
    });
  }

  async start(): Promise<void> {
    this.ctx = this.resolveContext();
    this.transport = new StdioServerTransport();
    await this.server.connect(this.transport);
    this.outputChannel.appendLine('[wwMCP] MCP server started (stdio transport)');
  }

  async stop(): Promise<void> {
    try {
      await this.server.close();
      this.outputChannel.appendLine('[wwMCP] MCP server stopped');
    } catch (err) {
      this.outputChannel.appendLine(`[wwMCP] stop error: ${err}`);
    }
  }
}

/**
 * Register the wwMCP server with the extension context.
 * Only starts if wildwest.mcp.enabled === true.
 */
export function registerMCPServer(
  context: vscode.ExtensionContext,
  outputChannel: vscode.OutputChannel,
  heartbeatMonitor: HeartbeatMonitor,
): void {
  const config = vscode.workspace.getConfiguration('wildwest');
  const enabled = config.get<boolean>('mcp.enabled', false);

  if (!enabled) {
    outputChannel.appendLine('[wwMCP] disabled (wildwest.mcp.enabled = false)');
    return;
  }

  const mcpServer = new wwMCPServer(heartbeatMonitor, outputChannel);
  mcpServer.start().catch((err) => {
    outputChannel.appendLine(`[wwMCP] failed to start: ${err}`);
    vscode.window.showWarningMessage(`Wild West MCP server failed to start: ${err}`);
  });

  context.subscriptions.push({
    dispose: () => { mcpServer.stop(); },
  });

  outputChannel.appendLine('[wwMCP] server registered');
}
