/**
 * AI Tool Adapter types — shared interface for all AI tool adapters.
 *
 * An AIToolAdapter connects a specific AI tool (Claude Code, Codex CLI, etc.)
 * to the AIToolBridge event bus. Each adapter:
 *  - Starts a listener (HTTP server, file watcher, SDK hook, etc.)
 *  - Emits AIToolEvents to its registered onEvent callback
 *  - Stops cleanly on dispose
 */

export type AIToolEventType =
  | 'session-start'   // A new AI tool session began
  | 'session-end'     // An AI tool session ended
  | 'turn-end'        // A single turn (user prompt + AI response) completed
  | 'file-changed';   // A file was written/modified by the AI tool

export interface AIToolEvent {
  /** Which adapter emitted this event */
  toolId: string;
  /** Event type */
  type: AIToolEventType;
  /** ISO timestamp of the event */
  timestamp: string;
  /** Tool-specific payload (hook POST body, file path, etc.) */
  payload?: Record<string, unknown>;
}

export interface AIToolAdapter {
  /** Unique identifier for this adapter (e.g. 'claude-code', 'codex-cli') */
  readonly toolId: string;
  /**
   * Start the adapter. Returns a promise that resolves when the adapter is
   * ready to emit events. Should not throw — on failure, call onError and
   * degrade gracefully.
   */
  start(onEvent: (event: AIToolEvent) => void, onError: (err: Error) => void): Promise<void>;
  /** Stop the adapter and release all resources. */
  stop(): Promise<void>;
}
