import * as vscode from 'vscode';
import { AIToolAdapter, AIToolEvent } from './aiToolAdapters/types';

/**
 * AIToolBridge — fan-in event bus for AI tool adapters.
 *
 * Core components (SessionExporter, TelegraphWatcher, etc.) subscribe here once.
 * Each AIToolAdapter emits events into this bus; subscribers receive all events
 * regardless of which tool generated them.
 *
 * Usage:
 *   const bridge = new AIToolBridge(outputChannel);
 *   bridge.onEvent((event) => { ... });
 *   bridge.registerAdapter(new ClaudeCodeAdapter(outputChannel));
 *   await bridge.start();
 *   // ...
 *   await bridge.stop();
 */
export class AIToolBridge {
  private adapters: AIToolAdapter[] = [];
  private subscribers: Array<(event: AIToolEvent) => void> = [];
  private outputChannel: vscode.OutputChannel;

  constructor(outputChannel: vscode.OutputChannel) {
    this.outputChannel = outputChannel;
  }

  /** Register an adapter. Must be called before start(). */
  registerAdapter(adapter: AIToolAdapter): void {
    this.adapters.push(adapter);
    this.outputChannel.appendLine(`[AIToolBridge] registered adapter: ${adapter.toolId}`);
  }

  /** Subscribe to all AI tool events from all adapters. */
  onEvent(subscriber: (event: AIToolEvent) => void): void {
    this.subscribers.push(subscriber);
  }

  /** Start all registered adapters. */
  async start(): Promise<void> {
    for (const adapter of this.adapters) {
      await adapter.start(
        (event) => this.emit(event),
        (err) => {
          this.outputChannel.appendLine(
            `[AIToolBridge] adapter '${adapter.toolId}' error: ${err.message} — falling back to polling`,
          );
        },
      );
    }
    this.outputChannel.appendLine(
      `[AIToolBridge] started — ${this.adapters.length} adapter(s) active`,
    );
  }

  /** Stop all registered adapters. */
  async stop(): Promise<void> {
    for (const adapter of this.adapters) {
      await adapter.stop();
    }
    this.outputChannel.appendLine(`[AIToolBridge] stopped`);
  }

  private emit(event: AIToolEvent): void {
    for (const sub of this.subscribers) {
      try {
        sub(event);
      } catch (err) {
        this.outputChannel.appendLine(`[AIToolBridge] subscriber error: ${err}`);
      }
    }
  }
}
