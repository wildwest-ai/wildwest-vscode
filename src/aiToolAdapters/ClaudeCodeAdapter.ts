import * as http from 'http';
import * as vscode from 'vscode';
import { AIToolAdapter, AIToolEvent } from './types';

// Default port — configurable via wildwest.claudeCode.hookPort setting
const DEFAULT_PORT = 7379;

/**
 * ClaudeCodeAdapter — receives Claude Code HTTP hooks (v2.1+).
 *
 * Starts a local HTTP server. Claude Code POSTs to:
 *   POST /hooks/claude/stop         — fired on every turn end (Stop hook)
 *   POST /hooks/claude/file-changed — fired when a *.md file is written
 *
 * Hook config lives in .claude/settings.json (project-local, gitignored).
 * Written automatically by TownInit on first activation.
 *
 * On port conflict: warns user and falls back to heartbeat polling.
 * Never throws — adapter failures must not crash the extension.
 */
export class ClaudeCodeAdapter implements AIToolAdapter {
  readonly toolId = 'claude-code';

  private server: http.Server | null = null;
  private outputChannel: vscode.OutputChannel;
  private port: number;

  constructor(outputChannel: vscode.OutputChannel) {
    this.outputChannel = outputChannel;
    this.port = vscode.workspace
      .getConfiguration('wildwest')
      .get<number>('claudeCode.hookPort', DEFAULT_PORT);
  }

  async start(
    onEvent: (event: AIToolEvent) => void,
    onError: (err: Error) => void,
  ): Promise<void> {
    this.server = http.createServer((req, res) => {
      if (req.method !== 'POST') {
        res.writeHead(405).end();
        return;
      }

      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        let payload: Record<string, unknown> = {};
        try { payload = JSON.parse(body); } catch { /* non-JSON body OK */ }

        const timestamp = new Date().toISOString();

        if (req.url === '/hooks/claude/stop') {
          onEvent({ toolId: this.toolId, type: 'turn-end', timestamp, payload });
          this.outputChannel.appendLine(`[ClaudeCodeAdapter] turn-end received`);
        } else if (req.url === '/hooks/claude/file-changed') {
          onEvent({ toolId: this.toolId, type: 'file-changed', timestamp, payload });
          this.outputChannel.appendLine(`[ClaudeCodeAdapter] file-changed: ${payload['file'] ?? '(unknown)'}`);
        } else {
          res.writeHead(404).end();
          return;
        }

        res.writeHead(200).end();
      });
    });

    return new Promise((resolve) => {
      this.server!.listen(this.port, '127.0.0.1', () => {
        this.outputChannel.appendLine(
          `[ClaudeCodeAdapter] listening on 127.0.0.1:${this.port} (port configurable via wildwest.claudeCode.hookPort)`,
        );
        resolve();
      });

      this.server!.on('error', (err: NodeJS.ErrnoException) => {
        const msg = err.code === 'EADDRINUSE'
          ? `ClaudeCodeAdapter failed to start: port ${this.port} already in use. ` +
            `Telegraph delivery will use heartbeat polling. ` +
            `Change port via wildwest.claudeCode.hookPort setting or reload extension.`
          : `ClaudeCodeAdapter error: ${err.message}`;
        this.outputChannel.appendLine(`[ClaudeCodeAdapter] WARNING: ${msg}`);
        vscode.window.showWarningMessage(`Wild West: ${msg}`);
        onError(new Error(msg));
        this.server = null;
        resolve(); // Degrade gracefully — do not reject
      });
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.server) { resolve(); return; }
      this.server.close(() => {
        this.outputChannel.appendLine(`[ClaudeCodeAdapter] stopped`);
        this.server = null;
        resolve();
      });
    });
  }
}
