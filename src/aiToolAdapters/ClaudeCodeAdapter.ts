import * as http from 'http';
import * as vscode from 'vscode';
import { AIToolAdapter, AIToolEvent } from './types';

// Default port — configurable via wildwest.claudeCode.hookPort setting
const DEFAULT_PORT = 7379;

// Auto-retry interval when port is in use (another VS Code window holds it).
const RETRY_INTERVAL_MS = 30_000;

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
 * On port conflict: warns user, falls back to heartbeat polling, and retries
 * every 30 s automatically so recovery is seamless when the holding window closes.
 * Never throws — adapter failures must not crash the extension.
 */
export class ClaudeCodeAdapter implements AIToolAdapter {
  readonly toolId = 'claude-code';

  private server: http.Server | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private outputChannel: vscode.OutputChannel;
  private port: number;
  private savedOnEvent: ((event: AIToolEvent) => void) | null = null;
  private savedOnError: ((err: Error) => void) | null = null;

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
    this.savedOnEvent = onEvent;
    this.savedOnError = onError;
    return this.tryBind(true);
  }

  async stop(): Promise<void> {
    // Cancel any pending retry first
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    return new Promise((resolve) => {
      if (!this.server) { resolve(); return; }
      this.server.close(() => {
        this.outputChannel.appendLine(`[ClaudeCodeAdapter] stopped`);
        this.server = null;
        resolve();
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private tryBind(isInitial: boolean): Promise<void> {
    const onEvent = this.savedOnEvent!;
    const onError = this.savedOnError!;

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
        if (!isInitial) {
          this.outputChannel.appendLine(
            `[ClaudeCodeAdapter] recovered — listening on 127.0.0.1:${this.port}`,
          );
        } else {
          this.outputChannel.appendLine(
            `[ClaudeCodeAdapter] listening on 127.0.0.1:${this.port} (port configurable via wildwest.claudeCode.hookPort)`,
          );
        }
        resolve();
      });

      this.server!.on('error', (err: NodeJS.ErrnoException) => {
        this.server = null;

        if (err.code === 'EADDRINUSE') {
          if (isInitial) {
            // Show warning once — not on every retry
            const msg =
              `ClaudeCodeAdapter failed to start: port ${this.port} already in use ` +
              `(another VS Code window may be holding it). ` +
              `Telegraph delivery will use heartbeat polling. ` +
              `Will auto-retry every 30 s. ` +
              `To use a different port set wildwest.claudeCode.hookPort.`;
            this.outputChannel.appendLine(`[ClaudeCodeAdapter] WARNING: ${msg}`);
            vscode.window.showWarningMessage(`Wild West: ${msg}`);
            onError(new Error(msg));
          } else {
            this.outputChannel.appendLine(
              `[ClaudeCodeAdapter] retry: port ${this.port} still in use — will try again in ${RETRY_INTERVAL_MS / 1000}s`,
            );
          }
          // Schedule retry regardless of attempt number
          this.retryTimer = setTimeout(() => {
            this.retryTimer = null;
            this.tryBind(false);
          }, RETRY_INTERVAL_MS);
        } else {
          const msg = `ClaudeCodeAdapter error: ${err.message}`;
          this.outputChannel.appendLine(`[ClaudeCodeAdapter] WARNING: ${msg}`);
          onError(new Error(msg));
        }

        resolve(); // Degrade gracefully — do not reject
      });
    });
  }
}
