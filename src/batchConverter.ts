/**
 * Batch Chat Session Converter (TypeScript)
 * 
 * Converts exported session JSON files from raw/ to staged/ folder with enriched metadata.
 * 
 * Usage:
 *   npx ts-node src/batchConverter.ts [exportPath]
 *   npx ts-node src/batchConverter.ts [exportPath] --json-only
 *   npx ts-node src/batchConverter.ts [exportPath] --with-markdown
 *   npx ts-node src/batchConverter.ts [exportPath] --markdown-only
 * 
 * Examples:
 *   npx ts-node src/batchConverter.ts ~/copilot-chats/reneyap
 *   npx ts-node src/batchConverter.ts ~/copilot-chats/reneyap --json-only
 * 
 * Pipeline: raw/{full-sessionId}.json → staged/{ISO-timestamp}_{8-char-id}.{json|md|log}
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { ChatSessionConverter } from './chatSessionConverter';
import { convertJsonFileToMarkdown } from './jsonToMarkdown';

interface ConversionResult {
  file: string;
  success: boolean;
  skipped?: boolean;
  skipReason?: string;
  error?: string;
  outputFiles?: {
    rawChat?: string;
    chatReplay?: string;
      markdown?: string;
  };
}

class BatchChatConverter {
  private exportPath: string;
  private inputDir: string;
  private outputDir: string;
  private results: ConversionResult[] = [];
  private gitUsername?: string;
  private jsonOnly: boolean;
    private withMarkdown: boolean;
    private markdownOnly: boolean;
  private conversionMetadata: Map<string, { sourceSessionId: string; sourceMtime: number }> = new Map();

    constructor(exportPath: string, jsonOnly = false, withMarkdown = false, markdownOnly = false) {
    this.exportPath = exportPath;
    this.inputDir = path.join(exportPath, 'raw');
    this.outputDir = path.join(exportPath, 'staged');
    this.jsonOnly = jsonOnly;
    this.withMarkdown = withMarkdown || markdownOnly;
    this.markdownOnly = markdownOnly;
    
    // Get git username from export path (user home directory)
    try {
      const username = execSync('git config user.name', {
        encoding: 'utf8'
      }).trim();
      this.gitUsername = username || undefined;
    } catch (error) {
      // Git not configured, username will be undefined
      this.gitUsername = undefined;
    }
    
    // Load conversion metadata for idempotency
    this.loadConversionMetadata();
  }

  /**
   * Load metadata about previous conversions for idempotency checks
   */
  private loadConversionMetadata(): void {
    const metadataPath = path.join(this.outputDir, '.conversion-metadata.json');
    
    try {
      if (fs.existsSync(metadataPath)) {
        const content = fs.readFileSync(metadataPath, 'utf8');
        const metadata = JSON.parse(content);
        this.conversionMetadata = new Map(Object.entries(metadata));
      }
    } catch (error) {
      // If metadata can't be loaded, start fresh
      this.conversionMetadata = new Map();
    }
  }

  /**
   * Format local timestamp for filenames: YYYY-MM-DDTHH-MM-SSUTC±HH-MM (no milliseconds)
   * Example: 2026-01-24T12-25-33-05-00
   */
  private formatLocalTimestampForFilename(timestamp: number): string {
    const date = new Date(timestamp);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    
    const offset = -date.getTimezoneOffset();
    const offsetHours = Math.floor(Math.abs(offset) / 60);
    const offsetMinutes = Math.abs(offset) % 60;
    const offsetSign = offset >= 0 ? '+' : '-';
    const offsetStr = `${offsetSign}${String(offsetHours).padStart(2, '0')}-${String(offsetMinutes).padStart(2, '0')}`;
    
    return `${year}-${month}-${day}T${hours}-${minutes}-${seconds}UTC${offsetStr}`;
  }

  /**
   * Save conversion metadata for next run
   */
  private saveConversionMetadata(): void {
    try {
      if (!fs.existsSync(this.outputDir)) {
        fs.mkdirSync(this.outputDir, { recursive: true });
      }
      
      const metadata = Object.fromEntries(this.conversionMetadata);
      const metadataPath = path.join(this.outputDir, '.conversion-metadata.json');
      fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), 'utf8');
    } catch (error) {
      // Silently fail if we can't save metadata
    }
  }

  /**
   * Find all session JSON files in the raw/ directory
   */
  private findSessionFiles(): string[] {
    // Recursively find all .json and .jsonl files in raw/ and its subfolders
    // Skip copilot-edits/ — those are file-edit timeline state files, not chat sessions
    const results: string[] = [];
    function walk(dir: string) {
      if (!fs.existsSync(dir)) return;
      const entries = fs.readdirSync(dir);
      for (const entry of entries) {
        const fullPath = path.join(dir, entry);
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
          if (entry === 'copilot-edits') continue; // skip — not chat sessions
          walk(fullPath);
        } else if ((entry.endsWith('.json') || entry.endsWith('.jsonl')) && !entry.startsWith('.')) {
          results.push(fullPath);
        }
      }
    }
    walk(this.inputDir);
    console.log(`[DEBUG] findSessionFiles: Found ${results.length} files:`);
    for (const f of results) {
      console.log(`[DEBUG]   - ${f}`);
    }
    return results;
  }

  /**
   * Check if a session has already been converted
   * Returns true if target exists and source hasn't changed (idempotent)
   */
  private isAlreadyConverted(sourceSessionId: string, sourceMtime: number, targetJsonPath: string): boolean {
    // Check if metadata exists for this session
    const metadata = this.conversionMetadata.get(sourceSessionId);
    
    // If metadata doesn't exist or target doesn't exist, needs conversion
    if (!metadata || !fs.existsSync(targetJsonPath)) {
      return false;
    }
    
    // If source mtime changed, needs re-conversion
    if (metadata.sourceMtime !== sourceMtime) {
      return false;
    }
    
    // Already converted and source unchanged
    return true;
  }

  /**
   * Convert a single session file from raw/ to staged/
   */
  private convertSession(sessionPath: string, gitUsername?: string): ConversionResult {
    const filename = path.basename(sessionPath);
    const ext = path.extname(filename);

    // copilot-edits sessions (chatEditingSessions) have a different schema —
    // they are file-edit timelines, not Q&A chat sessions. Skip for now.
    if (sessionPath.includes('copilot-edits')) {
      return { file: filename, success: false, error: 'copilot-edits sessions are not chat sessions (file-edit timeline format); skipping staging' };
    }

    const isClaude = sessionPath.includes('claude-code');
    const isCodex = !isClaude && (sessionPath.includes('chatgpt-codex') || filename.endsWith('.jsonl'));
    const provider = isClaude ? 'claude-code' : (isCodex ? 'chatgpt-codex' : 'github-copilot');
    const sourceSessionId = filename.replace(/\.(json|jsonl)$/, '');

    try {
      // Get source file mtime for idempotency
      const sourceStats = fs.statSync(sessionPath);
      const sourceMtime = sourceStats.mtimeMs;

      // Codex CLI session log (.jsonl)
      if (isCodex && ext === '.jsonl') {
        console.log(`[DEBUG] Processing Codex .jsonl: ${sessionPath}`);
        // Parse Codex JSONL and transform to replay format
        let lines: string[] = [];
        try {
          lines = fs.readFileSync(sessionPath, 'utf8').split(/\r?\n/).filter(Boolean);
        } catch (e) {
          console.error(`[ERROR] Failed to read Codex .jsonl file: ${sessionPath}`, e);
          return { file: filename, success: false, error: `Failed to read file: ${e}` };
        }
        const metaLine = lines.find(l => l.includes('session_meta'));
        interface CodexSessionMeta {
          git?: {
            user?: string;
            [key: string]: unknown;
          };
          [key: string]: unknown;
        }
        let meta: CodexSessionMeta = {};
        try {
          meta = metaLine ? JSON.parse(metaLine).payload : {};
        } catch (e) {
          console.error(`[ERROR] Failed to parse session_meta in: ${sessionPath}`, e);
        }
        const events = lines.map(l => {
          try { return JSON.parse(l); } catch { return null; }
        }).filter(e => e && e.type === 'response_item' && e.payload && e.payload.type === 'message');

        // Build prompts array
        const prompts = [];
        let lastUser: { prompt: string; timestamp: number } | null = null;
        for (const ev of events) {
          const msg = ev.payload.content?.[0]?.text || '';
          const role = ev.payload.role || '';
          const ts = Date.parse(ev.timestamp) || Date.now();
          if (role === 'user') {
            lastUser = { prompt: msg, timestamp: ts };
          } else if (role === 'assistant' || role === 'developer') {
            if (lastUser) {
              prompts.push({
                prompt: lastUser.prompt,
                timestamp: lastUser.timestamp,
                response: msg,
                hasSeen: false,
                logCount: 2,
                logs: [],
              });
              lastUser = null;
            }
          }
        }
        // If lastUser exists with no response, add as prompt only
        if (lastUser) {
          prompts.push({
            prompt: lastUser.prompt,
            timestamp: lastUser.timestamp,
            response: '',
            hasSeen: false,
            logCount: 1,
            logs: [],
          });
        }

        // Compose staged replay JSON
        const exportedAt = new Date().toISOString();
        const github_userid = gitUsername || (meta && meta.git && meta.git.user) || 'unknown';
        const user_timezone_offset = (() => {
          const now = new Date();
          const offset = -now.getTimezoneOffset();
          const h = Math.floor(Math.abs(offset) / 60);
          const m = Math.abs(offset) % 60;
          const sign = offset >= 0 ? '+' : '-';
          return `${sign}${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
        })();
        const totalPrompts = prompts.length;
        const totalLogEntries = prompts.length * 2;
        const lastPromptObj = prompts.length > 0 ? prompts[prompts.length - 1] : undefined;
        const lastUpdated = lastPromptObj && typeof lastPromptObj.timestamp === 'number' ? lastPromptObj.timestamp : Date.now();
        const sessionId = (meta && meta.id) || sourceSessionId;
        const baseName = `${this.formatLocalTimestampForFilename(lastUpdated)}_${provider}_${String(sessionId).substring(0,8)}`;
        const chatReplayPath = path.join(this.outputDir, `${baseName}.json`);
        const markdownPath = this.withMarkdown ? path.join(this.outputDir, `${baseName}.md`) : undefined;

        // Idempotency check
        const alreadyConverted = this.isAlreadyConverted(sourceSessionId, sourceMtime, chatReplayPath);
        const needsMarkdown = this.withMarkdown && markdownPath ? this.shouldGenerateMarkdown(chatReplayPath, markdownPath) : false;
        if (alreadyConverted && !needsMarkdown) {
          console.log(`[DEBUG] Skipping Codex .jsonl (already converted, unchanged): ${sessionPath}`);
          return {
            file: filename,
            success: true,
            skipped: true,
            skipReason: 'Already converted and source unchanged',
          };
        }

        // Ensure output directory exists before writing
        if (!fs.existsSync(this.outputDir)) {
          fs.mkdirSync(this.outputDir, { recursive: true });
        }
        // Write staged JSON
        if (!alreadyConverted) {
          try {
            const staged = {
              exportedAt,
              github_userid,
              user_timezone_offset,
              totalPrompts,
              totalLogEntries,
              sourceSession: meta,
              prompts,
            };
            fs.writeFileSync(chatReplayPath, JSON.stringify(staged, null, 2), 'utf8');
            console.log(`[DEBUG] Wrote staged Codex JSON: ${chatReplayPath}`);
          } catch (e) {
            console.error(`[ERROR] Failed to write staged Codex JSON: ${chatReplayPath}`, e);
            return { file: filename, success: false, error: `Failed to write staged JSON: ${e}` };
          }
        }

        // Markdown
        let markdownOut: string | undefined;
        if (this.withMarkdown && markdownPath) {
          try {
            markdownOut = this.convertJsonToMarkdown(chatReplayPath, markdownPath);
            console.log(`[DEBUG] Wrote staged Codex Markdown: ${markdownPath}`);
          } catch (e) {
            console.error(`[ERROR] Failed to write Codex Markdown: ${markdownPath}`, e);
          }
        }

        // Update metadata
        this.conversionMetadata.set(sourceSessionId, {
          sourceSessionId,
          sourceMtime,
        });

        return {
          file: filename,
          success: true,
          outputFiles: {
            chatReplay: chatReplayPath,
            markdown: markdownOut,
          },
        };
      }

      // Claude Code session JSON
      if (isClaude) {
        let rawSession: Record<string, unknown>;
        try {
          rawSession = JSON.parse(fs.readFileSync(sessionPath, 'utf8')) as Record<string, unknown>;
        } catch (e) {
          return { file: filename, success: false, error: `Failed to read Claude session: ${e}` };
        }

        const claudeMessages = Array.isArray(rawSession.messages)
          ? (rawSession.messages as Array<Record<string, unknown>>)
          : [];

        // Pair sequential user + assistant messages into prompts
        const prompts: Array<{
          prompt: string; timestamp: number; response: string;
          hasSeen: boolean; logCount: number; logs: unknown[];
        }> = [];
        let lastUser: Record<string, unknown> | null = null;
        for (const msg of claudeMessages) {
          if (msg.role === 'user') {
            lastUser = msg;
          } else if (msg.role === 'assistant' && lastUser) {
            prompts.push({
              prompt: (lastUser.content as string) || '',
              timestamp: (lastUser.timestamp as number) || Date.now(),
              response: (msg.content as string) || '',
              hasSeen: false,
              logCount: 2,
              logs: [],
            });
            lastUser = null;
          }
        }
        if (lastUser) {
          prompts.push({
            prompt: (lastUser.content as string) || '',
            timestamp: (lastUser.timestamp as number) || Date.now(),
            response: '',
            hasSeen: false,
            logCount: 1,
            logs: [],
          });
        }

        const claudeSessionId = (rawSession.sessionId as string) || sourceSessionId;
        const claudeCreationDate = (rawSession.creationDate as number) || Date.now();
        const claudeLastMessageDate = (rawSession.lastMessageDate as number) || claudeCreationDate;
        const baseName = `${this.formatLocalTimestampForFilename(claudeLastMessageDate)}_${provider}_${String(claudeSessionId).substring(0, 8)}`;
        const chatReplayPath = path.join(this.outputDir, `${baseName}.json`);
        const markdownPath = this.withMarkdown ? path.join(this.outputDir, `${baseName}.md`) : undefined;

        const alreadyConverted = this.isAlreadyConverted(sourceSessionId, sourceMtime, chatReplayPath);
        const needsMarkdown = this.withMarkdown && markdownPath ? this.shouldGenerateMarkdown(chatReplayPath, markdownPath) : false;
        if (alreadyConverted && !needsMarkdown) {
          return { file: filename, success: true, skipped: true, skipReason: 'Already converted and source unchanged' };
        }

        if (!fs.existsSync(this.outputDir)) {
          fs.mkdirSync(this.outputDir, { recursive: true });
        }

        if (!alreadyConverted) {
          const now = new Date();
          const offset = -now.getTimezoneOffset();
          const h = Math.floor(Math.abs(offset) / 60);
          const m = Math.abs(offset) % 60;
          const sign = offset >= 0 ? '+' : '-';
          const user_timezone_offset = `${sign}${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;

          const firstUserMsg = claudeMessages.find(msg => msg.role === 'user');
          const customTitle = firstUserMsg
            ? String(firstUserMsg.content || '').slice(0, 50)
            : claudeSessionId;

          const staged = {
            exportedAt: new Date().toISOString(),
            provider: 'claude-code',
            github_userid: gitUsername || 'unknown',
            user_timezone_offset,
            totalPrompts: prompts.length,
            totalLogEntries: prompts.length * 2,
            sourceSession: {
              customTitle,
              sessionId: claudeSessionId,
              projectPath: (rawSession.projectPath as string) || '',
              creationDate: claudeCreationDate,
              lastMessageDate: claudeLastMessageDate,
            },
            prompts,
          };
          fs.writeFileSync(chatReplayPath, JSON.stringify(staged, null, 2), 'utf8');
        }

        let markdownOut: string | undefined;
        if (this.withMarkdown && markdownPath) {
          try { markdownOut = this.convertJsonToMarkdown(chatReplayPath, markdownPath); } catch (e) { console.warn(`[WARN] Failed to generate Claude markdown: ${e}`); }
        }

        this.conversionMetadata.set(sourceSessionId, { sourceSessionId, sourceMtime });

        return {
          file: filename,
          success: true,
          outputFiles: { chatReplay: chatReplayPath, markdown: markdownOut },
        };
      }

      // Default: Copilot session JSON
      const converter = new ChatSessionConverter(sessionPath, gitUsername);
      const metadata = converter.getMetadata();

      // Ensure output directory exists
      if (!fs.existsSync(this.outputDir)) {
        fs.mkdirSync(this.outputDir, { recursive: true });
      }

      // Generate output filenames
      const sessionId = metadata.sessionId.substring(0, 8);
      const timestamp = this.formatLocalTimestampForFilename(metadata.lastMessageDate);
      const baseName = `${timestamp}_github-copilot_${sessionId}`;

      const chatReplayPath = path.join(this.outputDir, `${baseName}.json`);
      const markdownPath = this.withMarkdown ? path.join(this.outputDir, `${baseName}.md`) : undefined;

      // Check idempotency: skip if already converted and source unchanged, unless markdown is missing/outdated
      const alreadyConverted = this.isAlreadyConverted(sourceSessionId, sourceMtime, chatReplayPath);
      const needsMarkdown = this.withMarkdown && markdownPath ? this.shouldGenerateMarkdown(chatReplayPath, markdownPath) : false;
      if (alreadyConverted && !needsMarkdown) {
        return {
          file: filename,
          success: true,
          skipped: true,
          skipReason: 'Already converted and source unchanged',
        };
      }

      // Save exports (optionally skip .log)
      let rawChatPath: string | undefined;
      if (!this.jsonOnly) {
        rawChatPath = path.join(this.outputDir, `${baseName}.log`);
        converter.saveRawChatLog(rawChatPath);
      }
      if (!alreadyConverted) {
        converter.saveChatReplayJson(chatReplayPath);
      }

      let markdownOut: string | undefined;
      if (this.withMarkdown && markdownPath) {
        markdownOut = this.convertJsonToMarkdown(chatReplayPath, markdownPath);
      }

      // Update metadata for idempotency
      this.conversionMetadata.set(sourceSessionId, {
        sourceSessionId,
        sourceMtime,
      });

      return {
        file: filename,
        success: true,
        outputFiles: {
          rawChat: rawChatPath,
          chatReplay: chatReplayPath,
          markdown: markdownOut,
        },
      };
    } catch (error) {
      return {
        file: filename,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Run batch conversion
   */
  async run(): Promise<void> {
    console.log('');
    console.log('🔄 Batch Chat Session Converter');
    console.log('================================');
    console.log('');
    console.log(`Input directory:  ${this.inputDir}`);
    console.log(`Output directory: ${this.outputDir}`);
    console.log('');

    if (this.markdownOnly) {
      await this.generateMarkdownFromStaged();
    } else {
      // Find session files
      let sessionFiles: string[];
      try {
        sessionFiles = this.findSessionFiles();
      } catch (error) {
        console.error('❌ Error:', error instanceof Error ? error.message : String(error));
        process.exit(1);
      }

      if (sessionFiles.length === 0) {
        console.log('⚠️  No session files found in input directory');
        console.log('');
        console.log('Expected files: {sessionId}.json (no date prefix)');
        console.log('');
        process.exit(1);
      }

      console.log(`Found ${sessionFiles.length} session file(s) to convert`);
      console.log('');

      // Convert each file
      for (const sessionFile of sessionFiles) {
        const filename = path.basename(sessionFile);
        process.stdout.write(`Converting: ${filename}... `);

        const result = this.convertSession(sessionFile, this.gitUsername);
        this.results.push(result);

        if (result.success) {
          if (result.skipped) {
            console.log(`⏭️  (${result.skipReason})`);
          } else {
            console.log('✅');
          }
        } else {
          console.log(`❌ ${result.error}`);
        }
      }
    }

    // Save conversion metadata for idempotency
    this.saveConversionMetadata();

    // Print summary
    this.printSummary();
  }

  /**
   * Convert all staged JSON files to Markdown (idempotent by mtime)
   */
  private async generateMarkdownFromStaged(): Promise<void> {
    if (!fs.existsSync(this.outputDir)) {
      throw new Error(`Output directory not found: ${this.outputDir}`);
    }

    const files = fs.readdirSync(this.outputDir);
    const jsonFiles = files.filter((f) => f.endsWith('.json') && !f.startsWith('.'));

    if (jsonFiles.length === 0) {
      console.log('⚠️  No JSON files found in staged directory');
      return;
    }

    console.log(`Found ${jsonFiles.length} staged JSON file(s) to render as Markdown`);

    for (const jsonFile of jsonFiles) {
      const jsonPath = path.join(this.outputDir, jsonFile);
      const mdPath = jsonPath.replace(/\.json$/, '.md');

      process.stdout.write(`Rendering: ${jsonFile}... `);
      try {
        const shouldGenerate = this.shouldGenerateMarkdown(jsonPath, mdPath);
        if (!shouldGenerate) {
          console.log('⏭️  (up-to-date)');
          continue;
        }

        const markdownOut = this.convertJsonToMarkdown(jsonPath, mdPath);
        this.results.push({ file: jsonFile, success: true, outputFiles: { markdown: markdownOut } });
        console.log('✅');
      } catch (error) {
        this.results.push({
          file: jsonFile,
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
        console.log(`❌ ${error}`);
      }
    }
  }

  /**
   * Decide whether Markdown should be (re)generated for a JSON file.
   */
  private shouldGenerateMarkdown(jsonPath: string, mdPath: string): boolean {
    if (!fs.existsSync(mdPath)) return true;
    try {
      const jsonStat = fs.statSync(jsonPath);
      const mdStat = fs.statSync(mdPath);
      return mdStat.mtimeMs < jsonStat.mtimeMs;
    } catch {
      return true;
    }
  }

  private convertJsonToMarkdown(jsonPath: string, mdPath: string): string {
    const mdOut = convertJsonFileToMarkdown(jsonPath, mdPath);
    return mdOut;
  }

  /**
   * Print conversion summary
   */
  private printSummary(): void {
    const successful = this.results.filter((r) => r.success).length;
    const failed = this.results.filter((r) => !r.success).length;

    console.log('');
    console.log('================================');
    console.log('✅ Conversion Summary');
    console.log('================================');
    console.log(`Converted: ${successful}`);
    console.log(`Failed:    ${failed}`);
    console.log(`Total:     ${this.results.length}`);
    console.log('');

    if (successful > 0) {
      // Count output files
      const rawChatFiles = this.results.filter((r) => r.success && r.outputFiles?.rawChat).length;
      const chatReplayFiles = this.results.filter((r) => r.success && r.outputFiles?.chatReplay).length;
      const markdownFiles = this.results.filter((r) => r.success && r.outputFiles?.markdown).length;

      console.log('📊 Output Summary:');
      console.log(`  Raw chat logs:     ${rawChatFiles} files${this.jsonOnly ? ' (skipped by --json-only)' : ''}`);
      console.log(`  Chat replay JSON:  ${chatReplayFiles} files`);
      console.log(`  Markdown files:    ${markdownFiles} files${this.withMarkdown ? '' : ' (use --with-markdown)'}`);
      console.log('');

      // Show file sizes
      if (fs.existsSync(this.outputDir)) {
        const files = fs.readdirSync(this.outputDir);
        const logFiles = files.filter((f) => f.endsWith('.log'));
        const jsonFiles = files.filter((f) => f.endsWith('.json'));
        const mdFiles = files.filter((f) => f.endsWith('.md'));

        if (logFiles.length > 0) {
          console.log('Raw chat log files:');
          for (const file of logFiles) {
            const filePath = path.join(this.outputDir, file);
            const stats = fs.statSync(filePath);
            const size = this.formatBytes(stats.size);
            console.log(`  ${file} (${size})`);
          }
          console.log('');
        }

        if (jsonFiles.length > 0) {
          console.log('Chat replay JSON files:');
          for (const file of jsonFiles) {
            const filePath = path.join(this.outputDir, file);
            const stats = fs.statSync(filePath);
            const size = this.formatBytes(stats.size);
            console.log(`  ${file} (${size})`);
          }
          console.log('');
        }

        if (mdFiles.length > 0) {
          console.log('Markdown transcript files:');
          for (const file of mdFiles) {
            const filePath = path.join(this.outputDir, file);
            const stats = fs.statSync(filePath);
            const size = this.formatBytes(stats.size);
            console.log(`  ${file} (${size})`);
          }
          console.log('');
        }
      }

      console.log('✨ Ready to distribute to your team!');
    }

    if (failed > 0) {
      console.log('Failed conversions:');
      for (const result of this.results.filter((r) => !r.success)) {
        console.log(`  ❌ ${result.file}: ${result.error}`);
      }
      console.log('');
    }

    console.log('');
  }

  /**
   * Format bytes to human-readable size
   */
  private formatBytes(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }

    return `${size.toFixed(1)}${units[unitIndex]}`;
  }
}

/**
 * Main entry point
 */
async function main() {
  const args = process.argv.slice(2);
  const flags = args.filter((a) => a.startsWith('--'));
  const positional = args.filter((a) => !a.startsWith('--'));

  const jsonOnly = flags.includes('--json-only');
  const withMarkdown = flags.includes('--markdown') || flags.includes('--with-markdown');
  const markdownOnly = flags.includes('--markdown-only');

  // markdown-only implies jsonOnly (no .log) and skips raw conversion path entirely
  const effectiveJsonOnly = markdownOnly ? true : jsonOnly;

  const exportPath = positional[0] || path.resolve(process.cwd());

  const converter = new BatchChatConverter(exportPath, effectiveJsonOnly, withMarkdown, markdownOnly);

  try {
    await converter.run();
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

// Only run main if this is executed directly (not imported)
if (require.main === module) {
  main();
}

export { BatchChatConverter };
