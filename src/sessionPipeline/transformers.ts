/**
 * Session Export Pipeline — Tool Transformers
 * 
 * Normalize raw tool session formats into common NormalizedTurn schema.
 * Each tool (cpt, cld, ccx) has its own raw format and cursor tracking.
 */

import { NormalizedTurn, Cursor, ContentPart, PartKind, TurnMeta } from './types';

/**
 * Tool-agnostic interface for session transformation
 * 
 * Implementations handle tool-specific raw format parsing and
 * turn normalization.
 */
export interface ISessionTransformer {
  /**
   * Tool identifier
   */
  readonly tool: 'cld' | 'cpt' | 'ccx';

  /**
   * Parse raw tool session data
   * 
   * Returns the raw session object after JSON parsing.
   * Tool-specific format.
   */
  parseRaw(rawContent: string): unknown;

  /**
   * Extract current cursor position from raw session
   * 
   * Used to determine which turns are already stored and which are new.
   * Different tools track position differently (message_id, request_id, line_offset).
   */
  getCurrentCursor(rawSession: unknown): Cursor;

  /**
   * Transform raw session to normalized turns
   * 
   * Returns all turns present in the raw session, normalized to common schema.
   * Includes turn_index assignments (zero-based, monotonic).
   * 
   * Multi-part responses (e.g., thinking + text) may result in multiple
   * turns with consecutive indexes.
   */
  transformTurns(rawSession: unknown): NormalizedTurn[];

  /**
   * Get metadata about the session
   * 
   * Used to populate SessionRecord fields like project_path.
   */
  getSessionMetadata(rawSession: unknown): {
    project_path: string;
    session_type: 'chat' | 'edit';
    created_at?: string;
  };
}

/**
 * GitHub Copilot (cpt) transformer
 * 
 * Raw format: Copilot's native JSON session structure
 * Cursor: requestId (incrementing integer per turn)
 */
export class CopilotTransformer implements ISessionTransformer {
  readonly tool = 'cpt' as const;

  parseRaw(rawContent: string): unknown {
    return JSON.parse(rawContent);
  }

  getCurrentCursor(rawSession: unknown): Cursor {
    const session = rawSession as Record<string, unknown>;
    // Most recent request_id is the current cursor
    // (Copilot stores requests in order; last one is the cursor)
    const requests = (session['requests'] as Record<string, unknown>[]) || [];
    if (requests.length === 0) {
      return { type: 'request_id', value: -1 };
    }
    const lastRequest = requests[requests.length - 1];
    return { type: 'request_id', value: (lastRequest['requestId'] as string | number | undefined) ?? requests.length - 1 };
  }

  transformTurns(rawSession: unknown): NormalizedTurn[] {
    const session = rawSession as Record<string, unknown>;
    const requests = (session['requests'] as Record<string, unknown>[]) || [];
    const turns: NormalizedTurn[] = [];
    let turn_index = 0;

    // Session-level time bounds as fallback when per-request timestamps are absent
    const rawCreationDate = session['creationDate'];
    const rawLastMessageDate = session['lastMessageDate'];
    const sessionStart = rawCreationDate
      ? new Date(rawCreationDate as number).toISOString()
      : new Date().toISOString();
    const sessionEnd = rawLastMessageDate
      ? new Date(rawLastMessageDate as number).toISOString()
      : sessionStart;

    const resolveTimestamp = (raw: unknown, fallback: string): string => {
      if (raw === undefined || raw === null) return fallback;
      if (typeof raw === 'number') return new Date(raw).toISOString();
      if (typeof raw === 'string' && raw.length > 0) return raw;
      return fallback;
    };

    for (const request of requests) {
      // User message
      if (request['message']) {
        turns.push({
          turn_index: turn_index++,
          role: 'user',
          content: this.extractTextContent(request['message']),
          parts: this.extractParts(request['message']),
          meta: {
            tool_cursor_value: (request['requestId'] as string | number | undefined) ?? requests.indexOf(request),
            ...(request['meta'] as TurnMeta | undefined),
          },
          timestamp: resolveTimestamp(request['timestamp'], sessionStart),
        });
      }

      // Assistant response (may have multiple parts: thinking + text)
      if (request['response']) {
        const responseParts = this.extractParts(request['response']);

        // If response has multiple parts, split them into separate turns
        // (following the spec: multi-part turns become separate indexed turns)
        if (responseParts.length > 1) {
          for (const part of responseParts) {
            turns.push({
              turn_index: turn_index++,
              role: 'assistant',
              content: part.kind === 'text' ? part.content : '',
              parts: [part],
              meta: {
                tool_cursor_value: (request['requestId'] as string | number | undefined) ?? requests.indexOf(request),
                model: this.resolveModel(request),
                ...(request['meta'] as TurnMeta | undefined),
              },
              timestamp: resolveTimestamp(request['responseTimestamp'], sessionEnd),
            });
          }
        } else {
          // Single-part response
          turns.push({
            turn_index: turn_index++,
            role: 'assistant',
            content: this.extractTextContent(request['response']),
            parts: responseParts,
            meta: {
              tool_cursor_value: (request['requestId'] as string | number | undefined) ?? requests.indexOf(request),
              model: this.resolveModel(request),
              ...(request['meta'] as TurnMeta | undefined),
            },
            timestamp: resolveTimestamp(request['responseTimestamp'], sessionEnd),
          });
        }
      }
    }

    return turns;
  }

  getSessionMetadata(rawSession: unknown) {
    const session = rawSession as Record<string, unknown>;
    const rawCreationDate = session['creationDate'];
    const created_at = typeof rawCreationDate === 'number'
      ? new Date(rawCreationDate).toISOString()
      : undefined;
    return {
      project_path: (session['workspaceFolder'] as string) || '',
      session_type: 'chat' as const,
      created_at,
    };
  }

  private extractParts(content: unknown): ContentPart[] {
    if (typeof content === 'string') {
      return [{ kind: 'text' as const, content }];
    }

    // Copilot response format: array of typed items
    // Text items have no kind (null/absent); value field holds markdown text
    // Thinking items have kind='thinking'; value field holds reasoning text
    if (Array.isArray(content)) {
      const parts: ContentPart[] = [];
      for (const item of content as Record<string, unknown>[]) {
        const kind = item['kind'];
        if (kind === 'thinking') {
          parts.push({ kind: 'thinking' as const, content: (item['value'] as string) || '' });
        } else if (!kind) {
          parts.push({ kind: 'text' as const, content: (item['value'] as string) || '' });
        }
        // Skip: progressTaskSerialized, mcpServersStarting, prepareToolInvocation,
        //        toolInvocationSerialized, codeblockUri, unknown, etc.
      }
      return parts.length > 0 ? parts : [{ kind: 'text' as const, content: '' }];
    }

    // Copilot message (user) format: {text: '...', parts: [editor ranges...]}
    // Top-level 'text' is the canonical user input
    const structured = content as Record<string, unknown>;
    if (typeof structured['text'] === 'string') {
      return [{ kind: 'text' as const, content: structured['text'] }];
    }

    // Older format: dict with explicit parts array (thinking + text)
    if (structured['parts'] && Array.isArray(structured['parts'])) {
      return (structured['parts'] as Record<string, unknown>[]).map((part) => ({
        kind: ((part['kind'] as PartKind | undefined) ?? 'text') as PartKind,
        content: (part['content'] as string) || '',
        thinking_id: part['thinking_id'] as string | undefined,
      }));
    }

    return [{ kind: 'text' as const, content: '' }];
  }

  private extractTextContent(content: unknown): string {
    if (typeof content === 'string') return content;

    // Copilot response array: join null-kind items' 'value' fields
    if (Array.isArray(content)) {
      return (content as Record<string, unknown>[])
        .filter((item) => !item['kind'])
        .map((item) => (item['value'] as string) || '')
        .join('');
    }

    const structured = content as Record<string, unknown>;
    // Copilot user message: text is in top-level 'text' field
    if (typeof structured['text'] === 'string') return structured['text'];

    // Older format: dict with parts
    if (structured['parts'] && Array.isArray(structured['parts'])) {
      return (structured['parts'] as Record<string, unknown>[])
        .filter((p) => p['kind'] === 'text' || !p['kind'])
        .map((p) => (p['content'] as string) || '')
        .join('');
    }
    return '';
  }

  private resolveModel(request: Record<string, unknown>): string | undefined {
    const result = request['result'] as Record<string, unknown> | undefined;
    const meta = result?.['metadata'] as Record<string, unknown> | undefined;
    return (meta?.['resolvedModel'] as string | undefined) || (request['modelId'] as string | undefined);
  }
}

/**
 * Claude Code (cld) transformer
 * 
 * Raw format: Claude Code's native session structure (JSONL)
 * Cursor: message.id (UUID)
 */
export class ClaudeCodeTransformer implements ISessionTransformer {
  readonly tool = 'cld' as const;

  parseRaw(rawContent: string): unknown {
    // Claude Code files are plain JSON, not JSONL
    return JSON.parse(rawContent);
  }

  getCurrentCursor(rawSession: unknown): Cursor {
    const session = rawSession as Record<string, unknown>;
    const messages = (session['messages'] as Record<string, unknown>[]) || [];
    if (messages.length === 0) {
      return { type: 'message_id', value: '' };
    }
    const lastMessage = messages[messages.length - 1];
    return { type: 'message_id', value: (lastMessage['id'] as string) || '' };
  }

  transformTurns(rawSession: unknown): NormalizedTurn[] {
    const session = rawSession as Record<string, unknown>;
    const messages = (session['messages'] as Record<string, unknown>[]) || [];

    const rawCreationDate = session['creationDate'];
    const rawLastMessageDate = session['lastMessageDate'];
    const sessionStart = rawCreationDate
      ? new Date(rawCreationDate as number).toISOString()
      : new Date().toISOString();
    const sessionEnd = rawLastMessageDate
      ? new Date(rawLastMessageDate as number).toISOString()
      : sessionStart;

    const resolveTimestamp = (raw: unknown, fallback: string): string => {
      if (raw === undefined || raw === null) return fallback;
      if (typeof raw === 'number') return new Date(raw).toISOString();
      if (typeof raw === 'string' && raw.length > 0) return raw;
      return fallback;
    };

    const turns: NormalizedTurn[] = [];
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      const role = (msg['role'] as string) || 'user';
      const fallback = role === 'assistant' ? sessionEnd : sessionStart;

      turns.push({
        turn_index: i,
        role: role as 'user' | 'assistant',
        content: this.extractTextContent(msg['content']),
        parts: this.extractParts(msg['content']),
        meta: {
          tool_cursor_value: (msg['id'] as string) || '',
          model: (msg['model'] as string | undefined),
        },
        timestamp: resolveTimestamp(msg['timestamp'], fallback),
      });
    }

    return turns;
  }

  getSessionMetadata(rawSession: unknown) {
    const session = rawSession as Record<string, unknown>;
    return {
      project_path: (session['projectPath'] as string) || '',
      session_type: 'chat' as const,
    };
  }

  private extractParts(content: unknown): ContentPart[] {
    if (typeof content === 'string') {
      return [{ kind: 'text' as const, content }];
    }

    if (Array.isArray(content)) {
      return (content as Record<string, unknown>[]).map((part) => ({
        kind: ((part['kind'] as PartKind | undefined) ?? 'text') as PartKind,
        content: (part['text'] as string) || (part['content'] as string) || '',
        thinking_id: part['thinking_id'] as string | undefined,
      }));
    }

    return [{ kind: 'text' as const, content: JSON.stringify(content) }];
  }

  private extractTextContent(content: unknown): string {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return (content as Record<string, unknown>[])
        .filter((p) => p['kind'] === 'text' || !p['kind'])
        .map((p) => (p['text'] as string) || (p['content'] as string) || '')
        .join('');
    }
    return '';
  }
}

/**
 * ChatGPT Codex (ccx) transformer
 * 
 * Raw format: ChatGPT's JSONL export format
 * Cursor: line_offset (JSONL line number)
 */
export class CodexTransformer implements ISessionTransformer {
  readonly tool = 'ccx' as const;

  parseRaw(rawContent: string): unknown {
    const lines = rawContent.split('\n').filter((l) => l.trim());
    const parsed = lines.map((line) => JSON.parse(line) as Record<string, unknown>);

    // Extract session_meta fields
    const metaLine = parsed.find((m) => m['type'] === 'session_meta');
    const metaPayload = metaLine?.['payload'] as Record<string, unknown> | undefined;
    const sessionStart: string | undefined =
      (metaLine?.['timestamp'] as string | undefined) ||
      (metaPayload?.['timestamp'] as string | undefined);
    const projectPath: string =
      (metaPayload?.['cwd'] as string | undefined) || '';

    const model: string | undefined = metaPayload?.['model'] as string | undefined;

    return { messages: parsed, line_count: lines.length, session_start: sessionStart, project_path: projectPath, model };
  }

  getCurrentCursor(rawSession: unknown): Cursor {
    const session = rawSession as Record<string, unknown>;
    return { type: 'line_offset', value: (session['line_count'] as number) || 0 };
  }

  transformTurns(rawSession: unknown): NormalizedTurn[] {
    const session = rawSession as Record<string, unknown>;
    const messages = (session['messages'] as Record<string, unknown>[]) || [];
    const sessionStart = (session['session_start'] as string | undefined) || new Date().toISOString();
    const sessionModel = session['model'] as string | undefined;
    const turns: NormalizedTurn[] = [];
    let turn_index = 0;

    for (const msg of messages) {
      const type = msg['type'] as string | undefined;
      const timestamp = (msg['timestamp'] as string | undefined) || sessionStart;
      const payload = msg['payload'] as Record<string, unknown> | undefined;

      if (type === 'event_msg' && payload) {
        // User message
        const payloadType = payload['type'] as string | undefined;
        if (payloadType === 'user_message') {
          const content = (payload['message'] as string) || '';
          turns.push({
            turn_index: turn_index++,
            role: 'user',
            content,
            parts: [{ kind: 'text', content }],
            meta: { tool_cursor_value: turn_index - 1 },
            timestamp,
          });
        }
      } else if (type === 'response_item' && payload) {
        // Assistant (or developer system) message
        const role = payload['role'] as string | undefined;
        if (role === 'assistant') {
          const content = this.extractTextContent(payload['content']);
          turns.push({
            turn_index: turn_index++,
            role: 'assistant',
            content,
            parts: this.extractParts(payload['content']),
            meta: { tool_cursor_value: turn_index - 1, model: sessionModel },
            timestamp,
          });
        }
      }
      // Skip: session_meta, turn_context, response_item(developer/user/system)
    }

    return turns;
  }

  getSessionMetadata(rawSession: unknown) {
    const session = rawSession as Record<string, unknown>;
    return {
      project_path: (session['project_path'] as string) || '',
      session_type: 'chat' as const,
    };
  }

  private extractParts(content: unknown): ContentPart[] {
    if (typeof content === 'string') {
      return [{ kind: 'text' as const, content }];
    }

    if (Array.isArray(content)) {
      return (content as Record<string, unknown>[]).map((part) => ({
        kind: 'text' as const,
        // Codex uses `text` field; fallback to `content`
        content: (part['text'] as string) || (part['content'] as string) || '',
      }));
    }

    return [{ kind: 'text' as const, content: JSON.stringify(content) }];
  }

  private extractTextContent(content: unknown): string {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return (content as Record<string, unknown>[])
        .map((p) => (p['text'] as string) || (p['content'] as string) || '')
        .join('');
    }
    return '';
  }
}

/**
 * Get transformer for a given tool
 * 
 * @param tool Tool code ('cpt', 'cld', 'ccx')
 * @returns Transformer instance
 */
export function getTransformer(tool: string): ISessionTransformer {
  switch (tool) {
    case 'cpt':
      return new CopilotTransformer();
    case 'cld':
      return new ClaudeCodeTransformer();
    case 'ccx':
      return new CodexTransformer();
    default:
      throw new Error(`Unknown tool: ${tool}`);
  }
}
