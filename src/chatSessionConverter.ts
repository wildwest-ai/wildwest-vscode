/**
 * Chat Session Converter
 * 
 * Converts exported session JSON files to different formats:
 * 1. raw-chat.log - Plain text conversation format
 * 2. chatreplay.json - Official Copilot chat replay format
 * 
 * Can be used standalone or integrated into the extension.
 */

import * as fs from 'fs';
import * as path from 'path';

interface SessionRequest {
  requestId: string;
  message: {
    text: string;
    parts?: Array<{
      text: string;
      kind: string;
    }>;
  };
  response: Array<{
    kind: string;
    value?: string;
  }>;
  timestamp?: number;
}

interface ChatSession {
  version: number;
  sessionId: string;
  creationDate: number;
  lastMessageDate: number;
  requests: SessionRequest[];
  responderUsername?: string;
}

interface ChatReplayFormat {
  exportedAt: string;
  github_userid: string;
  user_timezone_offset: string;
  totalPrompts: number;
  totalLogEntries: number;
  sourceSession: ChatSession & {
    github_userid?: string;
    user_timezone_offset?: string;
  };
  prompts: Array<{
    prompt: string;
    timestamp?: number;
    response?: string;
    hasSeen: boolean;
    logCount: number;
    logs: Array<{
      id: string;
      kind: string;
      type: string;
    }>;
  }>;
}

class ChatSessionConverter {
  private session: ChatSession;
  private sessionPath: string;
  private gitUsername?: string;

  constructor(sessionJsonPath: string, gitUsername?: string) {
    this.sessionPath = sessionJsonPath;
    this.gitUsername = gitUsername;
    const content = fs.readFileSync(sessionJsonPath, 'utf8');
    this.session = this.normalizeSession(JSON.parse(content));
  }

  private normalizeSession(raw: Record<string, unknown>): ChatSession {
    const fallbackTimestamp = Date.now();
    const creationDate =
      typeof raw.creationDate === 'number' && Number.isFinite(raw.creationDate)
        ? raw.creationDate
        : fallbackTimestamp;
    const lastMessageDate =
      typeof raw.lastMessageDate === 'number' && Number.isFinite(raw.lastMessageDate)
        ? raw.lastMessageDate
        : creationDate;

    const requests =
      Array.isArray(raw.requests)
        ? (raw.requests
            .filter((req): req is Record<string, unknown> => !!req && typeof req === 'object' && !Array.isArray(req))
            .map((req) => req as unknown as SessionRequest))
        : [];

    return {
      version: typeof raw.version === 'number' ? raw.version : 1,
      sessionId:
        typeof raw.sessionId === 'string'
          ? raw.sessionId
          : path.basename(this.sessionPath, path.extname(this.sessionPath)),
      creationDate,
      lastMessageDate,
      requests,
      responderUsername: typeof raw.responderUsername === 'string' ? raw.responderUsername : undefined,
    };
  }

  /**
   * Extract text content from response objects
   */
  private extractResponseText(): string {
    if (!this.session.requests.length) return '';

    const request = this.session.requests[0];
    let responseText = '';

    const responseItems = Array.isArray(request.response) ? request.response : [];
    for (const item of responseItems) {
      if (item.kind === 'text' || item.kind === 'value') {
        responseText += typeof (item as { value?: string }).value === 'string' ? (item as { value?: string }).value : '';
      }
    }

    return responseText;
  }

  /**
   * Format LOCAL timestamp with timezone offset
   * Format: "YYYY-MM-DD HH:mm:ss.SSS UTC±HH:mm"
   * Example: "2026-01-24 12:25:33.000 UTC-05:00"
   */
  private formatTimestampWithTimezone(timestamp: number): string {
    const date = new Date(timestamp);
    
    // Get LOCAL time components (not UTC)
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    const milliseconds = String(date.getMilliseconds()).padStart(3, '0');
    
    // Calculate timezone offset
    const offset = -date.getTimezoneOffset(); // in minutes
    const offsetHours = Math.floor(Math.abs(offset) / 60);
    const offsetMinutes = Math.abs(offset) % 60;
    const offsetSign = offset >= 0 ? '+' : '-';
    const offsetStr = `UTC${offsetSign}${String(offsetHours).padStart(2, '0')}:${String(offsetMinutes).padStart(2, '0')}`;
    
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}.${milliseconds} ${offsetStr}`;
  }

  /**
   * Generate raw chat log format with timestamps and GitHub username
   * Format: "YYYY-MM-DD HH:mm:ss.SSS UTC±HH:mm username: ..." for global team collaboration
   */
  generateRawChatLog(): string {
    const logs: string[] = [];
    // Use provided git username, fallback to 'User'
    const username = this.gitUsername || 'User';

    for (const request of this.session.requests) {
      const timestamp = request.timestamp || Date.now();
      const formattedTime = this.formatTimestampWithTimezone(timestamp);

      // User message with timestamp and username
      const promptText =
        request && request.message && typeof request.message.text === 'string'
          ? request.message.text
          : '';
      logs.push(`${formattedTime} ${username}: ${promptText}`);
      logs.push('');

      // Copilot response - extract text content
      let responseText = '';
      const responseItems = Array.isArray(request.response) ? request.response : [];
      for (const item of responseItems) {
        if (item.value) {
          responseText += item.value;
        }
      }

      if (responseText) {
        // Response timestamp (slightly after user prompt)
        const responseTime = timestamp + 100; // Add 100ms
        const formattedResponseTime = this.formatTimestampWithTimezone(responseTime);
        
        logs.push(`${formattedResponseTime} GitHub Copilot: ${responseText}`);
      }
      logs.push('');
      logs.push('---');
      logs.push('');
    }

    return logs.join('\n');
  }

  /**
   * Generate Copilot's official chatreplay.json format - NOW WITH COMPLETE METADATA
   * Includes: github_userid, user_timezone_offset, timestamps, and full response text
   * This format is now self-contained and can regenerate .log without source
   */
  generateChatReplayJson(): ChatReplayFormat {
    // Get timezone offset for this system
    const now = new Date();
    const offset = -now.getTimezoneOffset(); // in minutes
    const offsetHours = Math.floor(Math.abs(offset) / 60);
    const offsetMinutes = Math.abs(offset) % 60;
    const offsetSign = offset >= 0 ? '+' : '-';
    const timezoneOffset = `${offsetSign}${String(offsetHours).padStart(2, '0')}:${String(offsetMinutes).padStart(2, '0')}`;

    const prompts = this.session.requests.map((request) => {
      const responseText = this.extractResponseTextFromRequest(request);
      const timestamp = request.timestamp || Date.now();
      return {
        prompt: request && request.message && typeof request.message.text === 'string' ? request.message.text : '',
        timestamp: timestamp,
        response: responseText,
        hasSeen: false,
        logCount: 1,
        logs: [
          {
            id: this.generateId(),
            kind: 'request',
            type: 'ChatMLSuccess',
          },
          {
            id: this.generateId(),
            kind: 'response',
            type: 'ChatMLSuccess',
          },
        ],
      };
    });

    return {
      exportedAt: new Date().toISOString(),
      github_userid: this.gitUsername || 'unknown',
      user_timezone_offset: timezoneOffset,
      totalPrompts: this.session.requests.length,
      totalLogEntries: this.session.requests.length * 2,
      sourceSession: {
        ...this.session,
        github_userid: this.gitUsername,
        user_timezone_offset: timezoneOffset,
      },
      prompts,
    };
  }

  /**
   * Extract response text from a request
   */
  private extractResponseTextFromRequest(request: SessionRequest): string {
    let responseText = '';
    const responseItems = Array.isArray(request.response) ? request.response : [];
    for (const item of responseItems) {
      if (item.kind === 'text' || item.kind === 'value') {
        responseText += typeof (item as { value?: string }).value === 'string' ? (item as { value?: string }).value : '';
      }
    }
    return responseText;
  }

  /**
   * Generate a simple ID (short hash)
   */
  private generateId(): string {
    return Math.random().toString(16).substring(2, 10);
  }

  /**
   * Save raw chat log to file
   */
  saveRawChatLog(outputPath: string): void {
    const content = this.generateRawChatLog();
    fs.writeFileSync(outputPath, content, 'utf8');
    console.log(`✓ Raw chat log saved: ${outputPath}`);
  }

  /**
   * Save chatreplay.json to file
   */
  saveChatReplayJson(outputPath: string): void {
    const content = this.generateChatReplayJson();
    fs.writeFileSync(outputPath, JSON.stringify(content, null, 2), 'utf8');
    console.log(`✓ Chat replay JSON saved: ${outputPath}`);
  }

  /**
   * STATIC METHOD: Regenerate .log from complete ChatReplay JSON (with metadata)
   * This is now possible because the JSON includes:
   * - github_userid
   * - user_timezone_offset  
   * - timestamp (per prompt)
   * - response text (per prompt)
   */
  static regenerateLogFromJson(jsonPath: string): string {
    const jsonContent = fs.readFileSync(jsonPath, 'utf8');
    const data = JSON.parse(jsonContent) as ChatReplayFormat;

    const logs: string[] = [];
    const userid = data.github_userid || 'User';
    const offset = data.user_timezone_offset || 'UTC±00:00';

    for (const prompt of data.prompts) {
      if (!prompt.timestamp) continue;

      const timestamp = prompt.timestamp;
      const date = new Date(timestamp);

      // Format: "YYYY-MM-DD HH:mm:ss.SSS UTC±HH:mm" using LOCAL time (not UTC)
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const hours = String(date.getHours()).padStart(2, '0');
      const minutes = String(date.getMinutes()).padStart(2, '0');
      const seconds = String(date.getSeconds()).padStart(2, '0');
      const milliseconds = String(date.getMilliseconds()).padStart(3, '0');
      const formattedTime = `${year}-${month}-${day} ${hours}:${minutes}:${seconds}.${milliseconds} UTC${offset}`;

      // User prompt
      logs.push(`${formattedTime} ${userid}: ${prompt.prompt}`);
      logs.push('');

      // Response (if exists)
      if (prompt.response) {
        const responseTime = `${year}-${month}-${day} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds() + 1).padStart(2, '0')}.${milliseconds} UTC${offset}`;
        logs.push(`${responseTime} GitHub Copilot: ${prompt.response}`);
      }
      logs.push('');
      logs.push('---');
      logs.push('');
    }

    return logs.join('\n');
  }

  /**
   * Get session metadata
   */
  getMetadata() {
    return {
      sessionId: this.session.sessionId,
      createdAt: new Date(this.session.creationDate).toISOString(),
      lastUpdated: new Date(this.session.lastMessageDate).toISOString(),
      lastMessageDate: this.session.lastMessageDate,
      totalPrompts: this.session.requests.length,
      responder: this.session.responderUsername || 'GitHub Copilot',
    };
  }
}

/**
 * CLI Interface - Run directly with: npx ts-node src/chatSessionConverter.ts <session.json>
 */
async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error('Usage: ts-node chatSessionConverter.ts <session.json> [output-dir]');
    console.error('');
    console.error('Examples:');
    console.error('  ts-node src/chatSessionConverter.ts docs/copilot-chats/reneyap/2026-01-05_*.json');
    console.error('  ts-node src/chatSessionConverter.ts session.json ./exports');
    process.exit(1);
  }

  const sessionPath = args[0];
  const outputDir = args[1] || path.dirname(sessionPath);

  if (!fs.existsSync(sessionPath)) {
    console.error(`Error: File not found: ${sessionPath}`);
    process.exit(1);
  }

  try {
    const converter = new ChatSessionConverter(sessionPath);
    const metadata = converter.getMetadata();

    console.log('');
    console.log('📋 Chat Session Converter');
    console.log('========================');
    console.log('');
    console.log('Session Metadata:');
    console.log(`  Session ID: ${metadata.sessionId}`);
    console.log(`  Created: ${metadata.createdAt}`);
    console.log(`  Updated: ${metadata.lastUpdated}`);
    console.log(`  Prompts: ${metadata.totalPrompts}`);
    console.log(`  Responder: ${metadata.responder}`);
    console.log('');

    // Generate basenames
    const sessionId = metadata.sessionId.substring(0, 8);
    const timestamp = new Date(metadata.lastUpdated).toISOString().replace(/[:.]/g, '-');
    const baseName = `${timestamp}_${sessionId}`;
    
    const rawChatPath = path.join(outputDir, `${baseName}.log`);
    const chatReplayPath = path.join(outputDir, `${baseName}.json`);

    // Ensure output directory exists
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    console.log('Generating exports...');
    console.log('');
    
    converter.saveRawChatLog(rawChatPath);
    converter.saveChatReplayJson(chatReplayPath);

    console.log('');
    console.log('✅ Conversion complete!');
    console.log('');
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

// Only run main if this is executed directly (not imported)
if (require.main === module) {
  main();
}

export { ChatSessionConverter, ChatReplayFormat };
