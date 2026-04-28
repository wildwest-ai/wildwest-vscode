import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as chokidar from 'chokidar';
import { BatchChatConverter } from './batchConverter';
import { convertJsonFileToMarkdown } from './jsonToMarkdown';
import { generateIndex } from './generateIndex';
import { execSync } from 'child_process';

interface ChatSession {
  id: string;
  timestamp: number;
  title?: string;
  messages?: unknown[];
}

export class SessionExporter {
  private watcher: chokidar.FSWatcher | null = null;
  private vscodeStoragePath: string;
  private exportPath: string;
  private statusBar: vscode.StatusBarItem;
  private isWatching: boolean = false;
  private outputChannel: vscode.OutputChannel;
  private exportedFiles: Set<string> = new Set();
  private dbPollInterval: NodeJS.Timeout | null = null;
  private lastDbStats: Map<string, { mtime: number; size: number }> = new Map();
  private outputLogPath: string = '';
  private userHome: string = '';
  private state: { version: number; initialized: boolean; lastDbStats: Record<string, { mtime: number; size: number }> } = { version: 1, initialized: false, lastDbStats: {} };
  private isScanning: boolean = false;
  private _lastLogMessage: string | null = null;

  constructor(context: vscode.ExtensionContext, outputChannel: vscode.OutputChannel) {
    this.outputChannel = outputChannel;
    const timestamp = new Date();
    const year = timestamp.getFullYear();
    const month = String(timestamp.getMonth() + 1).padStart(2, '0');
    const day = String(timestamp.getDate()).padStart(2, '0');
    const hours = String(timestamp.getHours()).padStart(2, '0');
    const minutes = String(timestamp.getMinutes()).padStart(2, '0');
    const seconds = String(timestamp.getSeconds()).padStart(2, '0');
    const ms = String(timestamp.getMilliseconds()).padStart(3, '0');
    this.log(`${year}-${month}-${day} ${hours}:${minutes}:${seconds}.${ms} [info] SessionExporter constructor called`);
    
    this.statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    // No command needed - hover will show actions
    
    // Determine VS Code storage path based on platform
    this.userHome = process.env.HOME || process.env.USERPROFILE || '';
    this.vscodeStoragePath = this.getVSCodeGlobalStoragePath(this.userHome);
    
    // Get export path from settings or use workspace default
    const config = vscode.workspace.getConfiguration('wildwest');
    const configPath = config.get<string>('exportPath');
    
    if (configPath) {
      this.exportPath = this.expandPath(configPath, this.userHome);
    } else {
      // Default: ${userHome}/wildwest-vscode/{git-username}/
      this.exportPath = this.getDefaultExportPath();
    }
    
    // Set output log path
    this.outputLogPath = path.join(this.exportPath, 'output.log');
    
    // Load state file
    this.state = this.loadState();
  }

  private log(message: string, appendDot: boolean = false): void {
    if (appendDot) {
      // Append dot to last line in output.log (no newline)
      try {
        this.outputChannel.append('.')
        fs.appendFileSync(this.outputLogPath, '.', 'utf8');
        this._lastLogMessage = '.';
      } catch (error) {
        // If we can't write to log, just continue
      }
      return;
    }
    // If the last log was a dot, prepend a newline before the next log entry
    let msg = message;
    if (this._lastLogMessage === '.') {
      this.outputChannel.append('\n');
      msg = '\n' + message;
    }
    this.outputChannel.appendLine(message);
    try {
      fs.appendFileSync(this.outputLogPath, msg + '\n', 'utf8');
      this._lastLogMessage = message;
    } catch (error) {
      // If we can't write to log, just continue
    }
  }

  private getVSCodeGlobalStoragePath(userHome: string): string {
    const platform = process.platform;
    let appData;
    switch (platform) {
      case 'darwin':
        return path.join(userHome, 'Library', 'Application Support', 'Code', 'User', 'globalStorage', 'github.copilot-chat');
      case 'win32':
        appData = process.env.APPDATA || '';
        return path.join(appData, 'Code', 'User', 'globalStorage', 'github.copilot-chat');
      case 'linux':
        return path.join(userHome, '.config', 'Code', 'User', 'globalStorage', 'github.copilot-chat');
      default:
        return path.join(userHome, '.vscode', 'globalStorage', 'github.copilot-chat');
    }
  }

  private getVSCodeLogsPath(userHome: string): string {
    const platform = process.platform;
    let appData;
    switch (platform) {
      case 'darwin':
        return path.join(userHome, 'Library', 'Application Support', 'Code', 'logs');
      case 'win32':
        appData = process.env.APPDATA || '';
        return path.join(appData, 'Code', 'logs');
      case 'linux':
        return path.join(userHome, '.config', 'Code', 'logs');
      default:
        return path.join(userHome, '.vscode', 'logs');
    }
  }

  private getWorkspaceStoragePaths(userHome: string): string[] {
    const platform = process.platform;
    const baseStoragePaths: string[] = [];
    let appData;
    let windowsUser: string | undefined;
    let windowsStoragePath: string | undefined;
    switch (platform) {
      case 'darwin':
        baseStoragePaths.push(path.join(userHome, 'Library', 'Application Support', 'Code', 'User', 'workspaceStorage'));
        break;
      case 'win32':
        appData = process.env.APPDATA || '';
        baseStoragePaths.push(path.join(appData, 'Code', 'User', 'workspaceStorage'));
        break;
      case 'linux':
        // Standard desktop path
        baseStoragePaths.push(path.join(userHome, '.config', 'Code', 'User', 'workspaceStorage'));
        // VS Code Remote / WSL server path
        baseStoragePaths.push(path.join(userHome, '.vscode-server', 'data', 'User', 'workspaceStorage'));
        // WSL: Check Windows storage via /mnt/c mount
        windowsUser = userHome.split('/').pop();
        if (windowsUser && fs.existsSync('/mnt/c/Users')) {
          windowsStoragePath = `/mnt/c/Users/${windowsUser}/AppData/Roaming/Code/User/workspaceStorage`;
          if (fs.existsSync(windowsStoragePath)) {
            baseStoragePaths.push(windowsStoragePath);
          }
        }
        break;
      default:
        return [];
    }

    const chatSessionPaths: string[] = [];
    for (const baseStoragePath of baseStoragePaths) {
      if (!fs.existsSync(baseStoragePath)) {
        continue;
      }

      try {
        const workspaces = fs.readdirSync(baseStoragePath);
        for (const workspace of workspaces) {
          const sessionsPath = path.join(baseStoragePath, workspace, 'chatSessions');
          if (fs.existsSync(sessionsPath)) {
            chatSessionPaths.push(sessionsPath);
          }
        }
      } catch (error) {
        this.log(`${this.getTimestamp('warn')} Error scanning workspace storage: ${error}`);
      }
    }
    
    return chatSessionPaths;
  }

  private getCodexSessionsPath(userHome: string): string {
    return path.join(userHome, '.codex', 'sessions');
  }

  private getClaudeProjectsPath(userHome: string): string {
    return path.join(userHome, '.claude', 'projects');
  }

  private isClaudeSidechain(content: string): boolean {
    const firstLine = content.slice(0, 2000).split(/\r?\n/).find(l => l.trim());
    if (!firstLine) return false;
    try {
      const event = JSON.parse(firstLine) as Record<string, unknown>;
      return event?.isSidechain === true;
    } catch {
      return false;
    }
  }

  private parseClaudeSession(
    content: string,
    filePath: string,
    defaultTimestamp: number
  ): { sessionId: string; projectPath: string; creationDate: number; lastMessageDate: number; messages: Array<{ role: string; content: string; timestamp: number; id: string; model?: string }> } | null {
    const lines = content.split(/\r?\n/);
    const messages: Array<{ role: string; content: string; timestamp: number; id: string; model?: string }> = [];
    let sessionId = '';
    let projectPath = '';
    let creationDate = defaultTimestamp;

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line) as Record<string, unknown>;
        if (!event || typeof event !== 'object') continue;
        if (event.isSidechain) continue;

        if (!sessionId && typeof event.sessionId === 'string') {
          sessionId = event.sessionId;
        }
        if (!projectPath && typeof event.cwd === 'string') {
          projectPath = event.cwd;
        }

        const eventType = event.type;
        if (eventType !== 'user' && eventType !== 'assistant') continue;

        const msg = event.message as Record<string, unknown> | undefined;
        if (!msg) continue;

        let msgContent = '';
        const rawContent = msg.content;
        if (typeof rawContent === 'string') {
          msgContent = rawContent;
        } else if (Array.isArray(rawContent)) {
          msgContent = (rawContent as Array<Record<string, unknown>>).map(item => {
            if (item.type === 'text') return (item.text as string) || '';
            return '';
          }).join('\n');
        }

        // Strip IDE-internal messages for user role
        if (eventType === 'user') {
          const clean = msgContent.replace(/<ide_[a-z_]+>[\s\S]*?<\/ide_[a-z_]+>/g, '').trim();
          if (!clean) continue;
          msgContent = clean;
        }

        if (!msgContent.trim()) continue;

        const ts = typeof event.timestamp === 'string'
          ? (new Date(event.timestamp).getTime() || defaultTimestamp)
          : defaultTimestamp;

        if (messages.length === 0) {
          creationDate = ts;
        }

        const entry: { role: string; content: string; timestamp: number; id: string; model?: string } = {
          role: eventType === 'assistant' ? 'assistant' : 'user',
          content: msgContent.trim(),
          timestamp: ts,
          id: typeof event.uuid === 'string' ? event.uuid : '',
        };
        if (typeof msg.model === 'string') {
          entry.model = msg.model;
        }
        messages.push(entry);
      } catch {
        // ignore malformed lines
      }
    }

    if (messages.length === 0) return null;

    if (!sessionId) {
      sessionId = path.basename(filePath, '.jsonl');
    }

    const lastMessageDate = messages[messages.length - 1]?.timestamp ?? creationDate;
    return { sessionId, projectPath, creationDate, lastMessageDate, messages };
  }

  /**
   * Returns all workspaceStorage/{hash}/chatEditingSessions/{sessionId}/state.json
   * paths.  These are Copilot Edits (agent mode) sessions — distinct from the
   * regular Copilot Chat sessions stored in chatSessions/.
   * Introduced prominently in VS Code / Copilot around late 2025 / early 2026.
   */
  private getCopilotEditSessionFiles(userHome: string): string[] {
    const platform = process.platform;
    const wsBasePaths: string[] = [];
    let appData;
    switch (platform) {
      case 'darwin':
        wsBasePaths.push(path.join(userHome, 'Library', 'Application Support', 'Code', 'User', 'workspaceStorage'));
        break;
      case 'win32':
        appData = process.env.APPDATA || '';
        wsBasePaths.push(path.join(appData, 'Code', 'User', 'workspaceStorage'));
        break;
      case 'linux':
        wsBasePaths.push(path.join(userHome, '.config', 'Code', 'User', 'workspaceStorage'));
        wsBasePaths.push(path.join(userHome, '.vscode-server', 'data', 'User', 'workspaceStorage'));
        break;
    }

    const stateFiles: string[] = [];
    for (const wsBase of wsBasePaths) {
      if (!fs.existsSync(wsBase)) continue;
      try {
        for (const ws of fs.readdirSync(wsBase)) {
          const editSessionsDir = path.join(wsBase, ws, 'chatEditingSessions');
          if (!fs.existsSync(editSessionsDir)) continue;
          for (const sessionId of fs.readdirSync(editSessionsDir)) {
            const stateFile = path.join(editSessionsDir, sessionId, 'state.json');
            if (fs.existsSync(stateFile)) {
              stateFiles.push(stateFile);
            }
          }
        }
      } catch (error) {
        this.log(`${this.getTimestamp('warn')} Error scanning chatEditingSessions: ${error}`);
      }
    }
    return stateFiles;
  }

  private exportEditSession(stateFilePath: string): void {
    try {
      const raw = fs.readFileSync(stateFilePath, 'utf8');
      const state = JSON.parse(raw);
      // Derive session ID from the parent directory name
      const sessionId = path.basename(path.dirname(stateFilePath));
      const providerDir = path.join(this.exportPath, 'raw', 'copilot-edits');
      if (!fs.existsSync(providerDir)) {
        fs.mkdirSync(providerDir, { recursive: true });
      }
      const exportFilePath = path.join(providerDir, `${sessionId}.json`);
      fs.writeFileSync(exportFilePath, JSON.stringify(state, null, 2), 'utf8');
      this.log(`${this.getTimestamp()} ✓ Exported Copilot Edits session to raw/copilot-edits/: ${sessionId}`);
    } catch (error) {
      this.log(`${this.getTimestamp('warn')} Error exporting edit session: ${error}`);
    }
  }

  /**
   * Returns the globalStorage/emptyWindowChatSessions path introduced in newer
   * VS Code / Copilot Chat releases.  Sessions opened outside of any workspace
   * (and increasingly all sessions after the Copilot update) are stored here
   * instead of workspaceStorage/{hash}/chatSessions/.
   */
  private getGlobalChatSessionPaths(userHome: string): string[] {
    const platform = process.platform;
    const paths: string[] = [];
    let appData;
    switch (platform) {
      case 'darwin':
        paths.push(path.join(userHome, 'Library', 'Application Support', 'Code', 'User', 'globalStorage', 'emptyWindowChatSessions'));
        break;
      case 'win32':
        appData = process.env.APPDATA || '';
        paths.push(path.join(appData, 'Code', 'User', 'globalStorage', 'emptyWindowChatSessions'));
        break;
      case 'linux':
        paths.push(path.join(userHome, '.config', 'Code', 'User', 'globalStorage', 'emptyWindowChatSessions'));
        // VS Code Remote / WSL server
        paths.push(path.join(userHome, '.vscode-server', 'data', 'User', 'globalStorage', 'emptyWindowChatSessions'));
        break;
    }
    return paths.filter(p => fs.existsSync(p));
  }

  private collectFiles(dir: string, predicate: (filepath: string) => boolean): string[] {
    const results: string[] = [];
    if (!fs.existsSync(dir)) return results;

    const entries = fs.readdirSync(dir);
    for (const entry of entries) {
      const filepath = path.join(dir, entry);
      const stat = fs.statSync(filepath);
      if (stat.isDirectory()) {
        results.push(...this.collectFiles(filepath, predicate));
      } else if (predicate(filepath)) {
        results.push(filepath);
      }
    }

    return results;
  }

  private isCopilotSessionFile(filename: string): boolean {
    return filename.endsWith('.json') || filename.endsWith('.jsonl');
  }

  private isLikelyCopilotSession(value: unknown): boolean {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return false;
    }

    const session = value as Record<string, unknown>;
    if (typeof session.sessionId === 'string') {
      return true;
    }

    const hasTimeline =
      typeof session.creationDate === 'number' ||
      typeof session.lastMessageDate === 'number' ||
      typeof session.createdAt === 'number';
    const hasMessages =
      Array.isArray(session.requests) ||
      Array.isArray(session.exchanges) ||
      Array.isArray(session.messages);

    return hasTimeline && hasMessages;
  }

  private toPatchPath(value: unknown): Array<string | number> | null {
    if (!Array.isArray(value)) return null;
    if (!value.every((segment) => typeof segment === 'string' || typeof segment === 'number')) {
      return null;
    }
    return value as Array<string | number>;
  }

  private applySessionPatch(
    target: Record<string, unknown>,
    patchPath: Array<string | number>,
    value: unknown,
    kind?: number,
    spliceIndex?: number
  ): void {
    if (patchPath.length === 0) {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        Object.assign(target, value as Record<string, unknown>);
      }
      return;
    }

    let cursor: unknown = target;
    for (let i = 0; i < patchPath.length - 1; i++) {
      const key = patchPath[i];
      const nextKey = patchPath[i + 1];

      if (!cursor || typeof cursor !== 'object') {
        return;
      }

      const container = cursor as Record<string, unknown> | Array<unknown>;
      const existing = (container as Record<string, unknown>)[String(key)];
      if (!existing || typeof existing !== 'object') {
        (container as Record<string, unknown>)[String(key)] = typeof nextKey === 'number' ? [] : {};
      }
      cursor = (container as Record<string, unknown>)[String(key)];
    }

    if (!cursor || typeof cursor !== 'object') {
      return;
    }

    const lastKey = String(patchPath[patchPath.length - 1]);

    // kind=2 is a splice/append operation: insert items into an existing array
    if (kind === 2 && Array.isArray(value)) {
      const existing = (cursor as Record<string, unknown>)[lastKey];
      if (Array.isArray(existing)) {
        if (typeof spliceIndex === 'number') {
          existing.splice(spliceIndex, 0, ...value);
        } else {
          existing.push(...value);
        }
        return;
      }
    }

    (cursor as Record<string, unknown>)[lastKey] = value;
  }

  private inferSessionLastMessageDate(session: Record<string, unknown>): number | null {
    const candidates: number[] = [];
    const pushCandidate = (value: unknown): void => {
      if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
        candidates.push(value);
      }
    };

    pushCandidate(session.lastMessageDate);
    pushCandidate(session.creationDate);

    const requests = session.requests;
    if (Array.isArray(requests)) {
      for (const request of requests) {
        if (!request || typeof request !== 'object' || Array.isArray(request)) continue;
        const req = request as Record<string, unknown>;
        pushCandidate(req.timestamp);

        const result = req.result;
        if (result && typeof result === 'object' && !Array.isArray(result)) {
          const resultObj = result as Record<string, unknown>;
          pushCandidate(resultObj.completedAt);
        }
      }
    }

    const modelState = session.modelState;
    if (modelState && typeof modelState === 'object' && !Array.isArray(modelState)) {
      pushCandidate((modelState as Record<string, unknown>).completedAt);
    }

    if (candidates.length === 0) {
      return null;
    }
    return Math.max(...candidates);
  }

  private normalizeCopilotSession(session: Record<string, unknown>): Record<string, unknown> {
    if (!Array.isArray(session.requests)) {
      session.requests = [];
    }

    const inferredLastMessageDate = this.inferSessionLastMessageDate(session);
    if (typeof session.lastMessageDate !== 'number' && inferredLastMessageDate !== null) {
      session.lastMessageDate = inferredLastMessageDate;
    }

    if (typeof session.creationDate !== 'number' && inferredLastMessageDate !== null) {
      session.creationDate = inferredLastMessageDate;
    }

    return session;
  }

  private parseCopilotSession(data: string, sessionFileName: string): { session: Record<string, unknown>; sessionId: string } {
    const ext = path.extname(sessionFileName).toLowerCase();
    const fallbackSessionId = sessionFileName.replace(/\.(json|jsonl)$/i, '');

    if (ext === '.jsonl') {
      const lines = data
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0);

      if (lines.length === 0) {
        throw new Error('Empty Copilot .jsonl session');
      }

      let rebuiltSession: Record<string, unknown> | null = null;

      // New Copilot format stores snapshots + patch events in an append-only log.
      for (let i = 0; i < lines.length; i++) {
        try {
          const parsed = JSON.parse(lines[i]) as unknown;
          if (parsed && typeof parsed === 'object') {
            const parsedObj = parsed as Record<string, unknown>;

            if (this.isLikelyCopilotSession(parsedObj)) {
              rebuiltSession = this.normalizeCopilotSession(parsedObj);
              continue;
            }

            const envelope = parsedObj.v;
            const kind = parsedObj.kind;
            if (
              (kind === 0 || kind === undefined) &&
              envelope &&
              typeof envelope === 'object' &&
              !Array.isArray(envelope) &&
              this.isLikelyCopilotSession(envelope)
            ) {
              rebuiltSession = this.normalizeCopilotSession(
                JSON.parse(JSON.stringify(envelope)) as Record<string, unknown>
              );
              continue;
            }

            const patchPath = this.toPatchPath(parsedObj.k);
            if (
              rebuiltSession &&
              patchPath &&
              (kind === 1 || kind === 2 || kind === 3 || kind === undefined) &&
              Object.prototype.hasOwnProperty.call(parsedObj, 'v')
            ) {
              const spliceIndex = typeof parsedObj.i === 'number' ? parsedObj.i : undefined;
              this.applySessionPatch(rebuiltSession, patchPath, parsedObj.v, kind as number | undefined, spliceIndex);
            }
          }
        } catch {
          // Continue scanning; future formats may include non-JSON lines.
        }
      }

      if (!rebuiltSession) {
        throw new Error('Could not parse Copilot .jsonl session envelope');
      }

      const session = this.normalizeCopilotSession(rebuiltSession);
      const sessionId = typeof session.sessionId === 'string' ? session.sessionId : fallbackSessionId;
      return { session, sessionId };
    }

    const parsed = JSON.parse(data) as Record<string, unknown>;
    const maybeEnvelope = parsed.v;
    let session: Record<string, unknown> | null = null;

    if (this.isLikelyCopilotSession(parsed)) {
      session = parsed;
    } else if (
      maybeEnvelope &&
      typeof maybeEnvelope === 'object' &&
      !Array.isArray(maybeEnvelope) &&
      this.isLikelyCopilotSession(maybeEnvelope)
    ) {
      session = maybeEnvelope as Record<string, unknown>;
    }

    if (!session) {
      throw new Error('Not a Copilot chat session object');
    }

    session = this.normalizeCopilotSession(session);
    const sessionId = typeof session.sessionId === 'string' ? session.sessionId : fallbackSessionId;
    return { session, sessionId };
  }

  private expandPath(configPath: string, userHome: string): string {
    return configPath
      .replace('${userHome}', userHome)
      .replace('~', userHome);
  }

  private getGitUsername(): string {
    try {
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      if (!workspaceFolder) {
        this.log(`${this.getTimestamp('warn')} No workspace folder open`);
        return 'unknown';
      }
      const cwd = workspaceFolder.uri.fsPath;
      this.log(`${this.getTimestamp()} Getting git username from: ${cwd}`);
      const username = execSync('git config user.name', { 
        encoding: 'utf8',
        cwd: cwd
      }).trim();
      this.log(`${this.getTimestamp()} Git username found: ${username}`);
      return username || 'unknown';
    } catch (error) {
      this.log(`${this.getTimestamp('error')} Error getting git username: ${error}`);
      console.warn('Could not get git username:', error);
      return 'unknown';
    }
  }

  private getTimestamp(level: string = 'info'): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    // Remove milliseconds for cleaner log output
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds} [${level}]`;
  }

  private validateGitConfig(): { valid: boolean; username: string; message?: string } {
    const username = this.getGitUsername();
    if (username === 'unknown' || !username) {
      return {
        valid: false,
        username: 'unknown',
        message: 'Git username not configured. Exports will save to "unknown" folder.'
      };
    }
    return {
      valid: true,
      username: username
    };
  }

  public async checkGitConfig(): Promise<boolean> {
    const validation = this.validateGitConfig();
    this.log(`${this.getTimestamp()} Git validation result: valid=${validation.valid}, username=${validation.username}`);
    if (!validation.valid) {
      const action = await vscode.window.showWarningMessage(
        '⚠️ Git username not configured',
        {
          modal: false,
          detail: 'Your Wild West exports will save to "docs/copilot-chats/unknown/". Configure your git username for proper organization.'
        },
        'Configure Now',
        'Ignore',
        'Learn More'
      );
      this.log(`User selected action: ${action}`);
      if (action === 'Configure Now') {
        const username = await vscode.window.showInputBox({
          prompt: 'Enter your git username',
          placeHolder: 'e.g., reneyap',
          validateInput: (value) => {
            if (!value || value.trim().length === 0) {
              return 'Username cannot be empty';
            }
            if (value.includes('/') || value.includes('\\')) {
              return 'Username cannot contain slashes';
            }
            return null;
          }
        });
        if (username) {
          try {
            execSync(`git config user.name "${username}"`);
            vscode.window.showInformationMessage(
              `✅ Git username set to: ${username}`,
              'Restart Watcher'
            ).then((action) => {
              if (action === 'Restart Watcher') {
                this.stop();
                setTimeout(() => this.start(), 500);
              }
            });
            return true;
          } catch (error) {
            this.log(`Failed to set git username: ${error}`);
            vscode.window.showErrorMessage(`Failed to set git username: ${error}`);
            return false;
          }
        }
        return false;
      } else if (action === 'Learn More') {
        vscode.env.openExternal(vscode.Uri.parse(
          'https://git-scm.com/book/en/v2/Getting-Started-First-Time-Git-Setup'
        ));
        return false;
      }
      // User clicked 'Ignore' or dismissed - allow to proceed
      this.log('User chose to ignore git config warning, proceeding anyway');
      return true;
    }
    this.log('Git configuration is valid, proceeding');
    return true;
  }

  private loadState(): { version: number; initialized: boolean; lastDbStats: Record<string, { mtime: number; size: number }> } {
    try {
      const stateFilePath = path.join(this.exportPath, '.wildwest-state.json');
      const legacyFilePath = path.join(this.exportPath, '.chatexport-state.json');
      // Migrate legacy state file from pre-0.1.3 installs
      if (!fs.existsSync(stateFilePath) && fs.existsSync(legacyFilePath)) {
        fs.renameSync(legacyFilePath, stateFilePath);
        this.log(`${this.getTimestamp()} Migrated state file: .chatexport-state.json → .wildwest-state.json`);
      }
      if (fs.existsSync(stateFilePath)) {
        const content = fs.readFileSync(stateFilePath, 'utf8');
        const loadedState = JSON.parse(content);
        this.log(`${this.getTimestamp()} Loaded state file: ${stateFilePath}`);
        return loadedState;
      }
    } catch (error) {
      this.log(`${this.getTimestamp('warn')} Error loading state file: ${error}`);
    }
    
    // Return default state if file doesn't exist or error occurred
    const defaultState = { version: 1, initialized: false, lastDbStats: {} };
    this.log(`${this.getTimestamp()} Initialized with default state`);
    return defaultState;
  }

  private saveState(): void {
    try {
      const stateFilePath = path.join(this.exportPath, '.wildwest-state.json');
      // Ensure export directory exists
      if (!fs.existsSync(this.exportPath)) {
        fs.mkdirSync(this.exportPath, { recursive: true });
      }
      fs.writeFileSync(stateFilePath, JSON.stringify(this.state, null, 2), 'utf8');
    } catch (error) {
      this.log(`${this.getTimestamp('error')} Error saving state file: ${error}`);
    }
  }

  private getDefaultExportPath(): string {
    const userHome = process.env.HOME || process.env.USERPROFILE || '';
    const username = this.getGitUsername();
    // Default: ${userHome}/wildwest-vscode/{git-username}/
    return path.join(userHome, 'wildwest-vscode', username);
  }

  async start(): Promise<void> {
    this.log(`${this.getTimestamp()} start() called`);
    
    if (this.isWatching) {
      vscode.window.showWarningMessage('Wild West watcher already running');
      return;
    }

    // Check git configuration before starting
    this.log(`${this.getTimestamp()} Checking git configuration...`);
    const gitConfigValid = await this.checkGitConfig();
    if (!gitConfigValid) {
      this.log(`${this.getTimestamp('error')} Git config validation failed`);
      vscode.window.showWarningMessage('Watcher not started. Please configure git username.');
      return;
    }
    this.log(`${this.getTimestamp()} Git configuration valid`);

    try {
      // Ensure export directory exists
      if (!fs.existsSync(this.exportPath)) {
        fs.mkdirSync(this.exportPath, { recursive: true });
        this.log(`Created export directory: ${this.exportPath}`);
      }

      // First-run initial scan: pause polling during scan
      if (!this.state.initialized) {
        this.log(`${this.getTimestamp()} Initializing for first run: scanning existing sessions...`);
        this.isScanning = true;
        await this.performInitialScan();
        this.isScanning = false;
        this.state.initialized = true;
        this.saveState();
        this.log(`${this.getTimestamp()} Initial scan complete. State initialized.`);
      }

      // Start polling after any initial scan
      this.isWatching = true;
      this.updateStatusBar();
      this.log(`${this.getTimestamp()} Wild West watcher started, polling every 5s`);
      this.startDatabasePolling();

      vscode.window.showInformationMessage('Wild West watcher started');
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to start watcher: ${error}`);
    }
  }

  async stop(): Promise<void> {
    if (this.dbPollInterval) {
      clearInterval(this.dbPollInterval);
      this.dbPollInterval = null;
    }
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
    // Always reset watching state regardless of whether a file-watcher was active
    // (the extension uses polling, so this.watcher is typically null)
    this.isWatching = false;
    this.exportedFiles.clear();
    this.lastDbStats.clear();
    this.updateStatusBar();
    vscode.window.showInformationMessage('Wild West watcher stopped');
  }

  private startDatabasePolling(): void {
    // Always end this log message with a newline for clean output
    this.log(`${this.getTimestamp()} Starting chat session polling (every 5 seconds)...\n`);
    this.dbPollInterval = setInterval(() => {
      if (this.isWatching) {
        this.checkAllChatSessions();
      }
    }, 5000);
  }


  // Polls all chat providers (Copilot and Codex) for new/updated sessions
  private checkAllChatSessions(): void {
    if (this.isScanning) {
      return;
    }
    const userHome = process.env.HOME || process.env.USERPROFILE || '';
    let activity = false;
    try {
      // Check Copilot sessions
      if (this.checkCopilotSessions(userHome)) {
        activity = true;
      }
      // Check Codex sessions
      if (this.checkCodexSessions(userHome)) {
        activity = true;
      }
      // Check Copilot Edits sessions (agent/edit mode)
      if (this.checkCopilotEditSessions(userHome)) {
        activity = true;
      }
      // Check Claude Code sessions
      if (this.checkClaudeSessions(userHome)) {
        activity = true;
      }
      // Save state after polling cycle (even if no activity)
      this.saveState();
      if (activity) {
        this.log(`${this.getTimestamp()} State file saved: ${path.join(this.exportPath, '.wildwest-state.json')}`);
      } else {
        // Only log heartbeat dot, do not log state file saves for idle cycles
        // (No state file log at all for idle cycles)
        this.log('.', true);
      }
    } catch (error) {
      // Silently ignore errors to avoid breaking polling loop
    }
  }

  // Polls Copilot chat session storage for new/updated sessions
  private checkCopilotSessions(userHome: string): boolean {
    // Combine workspace-scoped sessions (legacy) and the new global sessions location
    const chatSessionDirs = [
      ...this.getWorkspaceStoragePaths(userHome),
      ...this.getGlobalChatSessionPaths(userHome),
    ];
    let activity = false;
    for (const chatSessionsPath of chatSessionDirs) {
      if (!fs.existsSync(chatSessionsPath)) continue;
      const sessions = fs.readdirSync(chatSessionsPath);
      for (const sessionFile of sessions) {
        if (this.isCopilotSessionFile(sessionFile)) {
          const fullPath = path.join(chatSessionsPath, sessionFile);
          const stats = fs.statSync(fullPath);
          const key = fullPath;
          const lastStats = this.state.lastDbStats[key];
          if (!lastStats || stats.mtimeMs !== lastStats.mtime || stats.size !== lastStats.size) {
            if (stats.size > 0) {
              this.log(`${this.getTimestamp()} 💬 Chat session activity detected - exporting...`);
              this.exportChatSession(fullPath, sessionFile);
              this.state.lastDbStats[key] = {
                mtime: stats.mtimeMs,
                size: stats.size
              };
              activity = true;
            }
          }
        }
      }
    }
    return activity;
  }

  private exportChatSession(filePath: string, sessionFileName: string): void {
    try {
      const data = fs.readFileSync(filePath, 'utf8');
      const { session, sessionId } = this.parseCopilotSession(data, sessionFileName);
      const providerDir = path.join(this.exportPath, 'raw', 'github-copilot');
      if (!fs.existsSync(providerDir)) {
        fs.mkdirSync(providerDir, { recursive: true });
      }
      const exportFilePath = path.join(providerDir, `${sessionId}.json`);
      // Pretty-print the JSON for readability
      const jsonContent = JSON.stringify(session, null, 2);
      fs.writeFileSync(exportFilePath, jsonContent, 'utf8');
      this.log(`${this.getTimestamp()} ✓ Exported chat session to raw/github-copilot/: ${sessionId}`);
    } catch (error) {
      this.log(`${this.getTimestamp('warn')} Error exporting chat session: ${error}`);
    }
  }

  private checkCopilotEditSessions(userHome: string): boolean {
    let activity = false;
    const stateFiles = this.getCopilotEditSessionFiles(userHome);
    for (const stateFile of stateFiles) {
      const stats = fs.statSync(stateFile);
      const key = stateFile;
      const lastStats = this.state.lastDbStats[key];
      if (!lastStats || stats.mtimeMs !== lastStats.mtime || stats.size !== lastStats.size) {
        if (stats.size > 0) {
          this.log(`${this.getTimestamp()} ✏️ Copilot Edits session activity detected - exporting...`);
          this.exportEditSession(stateFile);
          this.state.lastDbStats[key] = { mtime: stats.mtimeMs, size: stats.size };
          activity = true;
        }
      }
    }
    return activity;
  }

  private checkCodexSessions(userHome: string): boolean {
    let codexActivity = false;
    const codexSessionsPath = this.getCodexSessionsPath(userHome);
    if (!fs.existsSync(codexSessionsPath)) return false;

    const files = this.collectFiles(codexSessionsPath, (filepath) => filepath.endsWith('.jsonl'));
    for (const filepath of files) {
      const stats = fs.statSync(filepath);
      const key = filepath;
      const lastStats = this.state.lastDbStats[key];

      if (!lastStats || stats.mtimeMs !== lastStats.mtime || stats.size !== lastStats.size) {
        if (stats.size > 0) {
          this.log(`${this.getTimestamp()} 💬 Codex session activity detected - exporting...`);
          this.exportCodexSession(filepath);
          this.state.lastDbStats[key] = {
            mtime: stats.mtimeMs,
            size: stats.size,
          };
          codexActivity = true;
        }
      }
    }
    return codexActivity;
  }

  private exportCodexSession(filePath: string): void {
    try {
      // Route to raw/chatgpt-codex/ subfolder
      const providerDir = path.join(this.exportPath, 'raw', 'chatgpt-codex');
      if (!fs.existsSync(providerDir)) {
        fs.mkdirSync(providerDir, { recursive: true });
      }
      const filename = path.basename(filePath);
      const exportFilePath = path.join(providerDir, filename);
      fs.copyFileSync(filePath, exportFilePath);
      this.log(`${this.getTimestamp()} ✓ Exported Codex session to raw/chatgpt-codex/: ${filename}`);
    } catch (error) {
      this.log(`${this.getTimestamp('warn')} Error exporting Codex session: ${error}`);
    }
  }

  private exportClaudeSession(filePath: string): void {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      if (this.isClaudeSidechain(content)) return;
      const stats = fs.statSync(filePath);
      const defaultTs = stats.birthtimeMs > 0 ? stats.birthtimeMs : stats.mtimeMs;
      const parsed = this.parseClaudeSession(content, filePath, defaultTs);
      if (!parsed) return;
      const providerDir = path.join(this.exportPath, 'raw', 'claude-code');
      if (!fs.existsSync(providerDir)) {
        fs.mkdirSync(providerDir, { recursive: true });
      }
      const exportFilePath = path.join(providerDir, `${parsed.sessionId}.json`);
      const session = {
        sessionId: parsed.sessionId,
        projectPath: parsed.projectPath,
        creationDate: parsed.creationDate,
        lastMessageDate: parsed.lastMessageDate,
        messages: parsed.messages,
      };
      fs.writeFileSync(exportFilePath, JSON.stringify(session, null, 2), 'utf8');
      this.log(`${this.getTimestamp()} ✓ Exported Claude session to raw/claude-code/: ${parsed.sessionId}`);
    } catch (error) {
      this.log(`${this.getTimestamp('warn')} Error exporting Claude session: ${error}`);
    }
  }

  private checkClaudeSessions(userHome: string): boolean {
    let activity = false;
    const claudeProjectsPath = this.getClaudeProjectsPath(userHome);
    if (!fs.existsSync(claudeProjectsPath)) return false;
    const files = this.collectFiles(claudeProjectsPath, (filepath) => filepath.endsWith('.jsonl'));
    for (const filepath of files) {
      const stats = fs.statSync(filepath);
      const key = filepath;
      const lastStats = this.state.lastDbStats[key];
      if (!lastStats || stats.mtimeMs !== lastStats.mtime || stats.size !== lastStats.size) {
        if (stats.size > 0) {
          this.log(`${this.getTimestamp()} 🤖 Claude session activity detected - exporting...`);
          this.exportClaudeSession(filepath);
          this.state.lastDbStats[key] = { mtime: stats.mtimeMs, size: stats.size };
          activity = true;
        }
      }
    }
    return activity;
  }

  private async onFileChange(filepath: string): Promise<void> {
    // Skip if already exported in this session
    if (this.exportedFiles.has(filepath)) {
      this.log(`${this.getTimestamp()} File already exported (cached): ${path.basename(filepath)}`);
      return;
    }

    this.log(`${this.getTimestamp()} File changed: ${path.basename(filepath)}`);
    
    if (this.shouldProcessFile(filepath)) {
      this.log(`${this.getTimestamp()} Exporting changed file...`);
      const config = vscode.workspace.getConfiguration('wildwest');
      if (config.get<boolean>('autoExportOnChange')) {
        this.exportChatSession(filepath, path.basename(filepath));
        this.exportedFiles.add(filepath);
      } else {
        this.log(`${this.getTimestamp('warn')} Auto-export on change is disabled`);
      }
    }
  }

  private async onFileAdd(filepath: string): Promise<void> {
    // Skip if already exported in this session
    if (this.exportedFiles.has(filepath)) {
      this.log(`${this.getTimestamp()} File already exported (cached): ${path.basename(filepath)}`);
      return;
    }

    this.log(`${this.getTimestamp()} 📝 New chat detected: ${path.basename(filepath)}`);
    
    if (this.shouldProcessFile(filepath)) {
      this.exportChatSession(filepath, path.basename(filepath));
      this.exportedFiles.add(filepath);
    }
  }

  private shouldProcessFile(filepath: string): boolean {
    const filename = path.basename(filepath).toLowerCase();
    return (
      filename.includes('chat') ||
      filename.includes('copilot') ||
      filename.endsWith('.json') ||
      filename.endsWith('.jsonl') ||
      filename.endsWith('.log') ||
      filename.endsWith('.db') ||
      filename.endsWith('.sqlite')
    );
  }

  private async exportChat(sourceFile: string): Promise<void> {
    try {
      const filename = path.basename(sourceFile);
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      
      this.log(`${this.getTimestamp()} Starting export: ${filename}`);
      
      // Create dated session folder
      const sessionPath = path.join(
        this.exportPath,
        new Date().getFullYear().toString(),
        this.padDate(new Date().getMonth() + 1) + this.padDate(new Date().getDate())
      );

      if (!fs.existsSync(sessionPath)) {
        fs.mkdirSync(sessionPath, { recursive: true });
        this.log(`${this.getTimestamp()} Created session directory: ${sessionPath}`);
      }

      // Read and copy file
      const data = fs.readFileSync(sourceFile);
      
      // For log files, use a simpler naming scheme to avoid duplicates
      const isLogFile = filename.endsWith('.log');
      let exportFile: string;
      
      if (isLogFile) {
        // For log files, use format: YYYY-MM-DD_filename (one per day, updated in place)
        const now = new Date();
        const datePrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        const cleanFilename = filename.replace(/\s+/g, '_'); // Replace spaces with underscores
        exportFile = path.join(sessionPath, `${datePrefix}_${cleanFilename}`);
        
        // If file exists and new content is smaller or same size, skip (keep larger/newer version)
        if (fs.existsSync(exportFile)) {
          const existingSize = fs.statSync(exportFile).size;
          if (data.length <= existingSize) {
            this.log(`${this.getTimestamp()} Skipping ${filename} - existing version is newer/larger (${existingSize} bytes vs ${data.length} bytes)`);
            return;
          }
          this.log(`${this.getTimestamp()} Updating ${filename} - new version is larger (${data.length} bytes vs ${existingSize} bytes)`);
        }
      } else {
        // For other files, keep timestamped versions
        exportFile = path.join(sessionPath, `${timestamp}_${filename}`);
      }
      
      fs.writeFileSync(exportFile, data);

      this.log(`${this.getTimestamp()} ✓ Exported: ${filename} -> ${exportFile}`);
      this.log(`${this.getTimestamp()} File size: ${(data.length / 1024).toFixed(2)} KB`);
      
      // Log export activity
      this.logExportActivity(`Exported: ${filename} -> ${exportFile}`);
    } catch (error) {
      this.log(`${this.getTimestamp('error')} Export failed for ${sourceFile}: ${error}`);
      console.error('Export error:', error);
    }
  }

  private async performInitialScan(): Promise<void> {
    try {
      this.log(`${this.getTimestamp()} Running initial scan for existing chats...`);
      let fileCount = 0;

      // Copilot sessions → raw/github-copilot/
      // Combine workspace-scoped sessions (legacy) and the new global sessions directory
      const sessionDirs = [
        ...this.getWorkspaceStoragePaths(this.userHome),
        ...this.getGlobalChatSessionPaths(this.userHome),
      ];
      for (const chatSessionsPath of sessionDirs) {
        if (fs.existsSync(chatSessionsPath)) {
          const sessions = fs.readdirSync(chatSessionsPath);
          for (const sessionFile of sessions) {
            if (this.isCopilotSessionFile(sessionFile)) {
              const fullPath = path.join(chatSessionsPath, sessionFile);
              const stats = fs.statSync(fullPath);

              // Read and parse session JSON
              try {
                const raw = fs.readFileSync(fullPath, 'utf8');
                const { session, sessionId } = this.parseCopilotSession(raw, sessionFile);

                // Ensure raw/github-copilot/ subfolder exists
                const providerDir = path.join(this.exportPath, 'raw', 'github-copilot');
                if (!fs.existsSync(providerDir)) {
                  fs.mkdirSync(providerDir, { recursive: true });
                }

                const outPath = path.join(providerDir, `${sessionId}.json`);
                fs.writeFileSync(outPath, JSON.stringify(session, null, 2), 'utf8');

                // Update state for idempotency
                this.state.lastDbStats[fullPath] = {
                  mtime: stats.mtimeMs,
                  size: stats.size,
                };
                fileCount++;
              } catch (e) {
                // Skip malformed files
              }
            }
          }
        }
      }

      // Codex sessions → raw/chatgpt-codex/
      const codexSessionsPath = this.getCodexSessionsPath(this.userHome);
      const codexFiles = this.collectFiles(codexSessionsPath, (filepath) => filepath.endsWith('.jsonl'));
      for (const filepath of codexFiles) {
        const stats = fs.statSync(filepath);
        const filename = path.basename(filepath);

        const providerDir = path.join(this.exportPath, 'raw', 'chatgpt-codex');
        if (!fs.existsSync(providerDir)) {
          fs.mkdirSync(providerDir, { recursive: true });
        }

        const outPath = path.join(providerDir, filename);
        fs.copyFileSync(filepath, outPath);

        this.state.lastDbStats[filepath] = {
          mtime: stats.mtimeMs,
          size: stats.size,
        };
        fileCount++;
      }

      // Copilot Edits sessions → raw/copilot-edits/
      const editStateFiles = this.getCopilotEditSessionFiles(this.userHome);
      for (const stateFile of editStateFiles) {
        const stats = fs.statSync(stateFile);
        this.exportEditSession(stateFile);
        this.state.lastDbStats[stateFile] = { mtime: stats.mtimeMs, size: stats.size };
        fileCount++;
      }

      // Claude Code sessions → raw/claude-code/
      const claudeProjectsPath = this.getClaudeProjectsPath(this.userHome);
      const claudeFiles = this.collectFiles(claudeProjectsPath, (filepath) => filepath.endsWith('.jsonl'));
      for (const filepath of claudeFiles) {
        const stats = fs.statSync(filepath);
        try {
          this.exportClaudeSession(filepath);
        } catch (e) {
          this.log(`${this.getTimestamp('warn')} Error in initial Claude scan: ${e}`);
        }
        this.state.lastDbStats[filepath] = { mtime: stats.mtimeMs, size: stats.size };
        fileCount++;
      }

      this.saveState();
      this.log(`${this.getTimestamp()} Initial scan complete: ${fileCount} sessions exported to raw/`);
    } catch (error) {
      this.log(`${this.getTimestamp('error')} Error during initial scan: ${error}`);
    }
  }

  async exportNow(): Promise<void> {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      vscode.window.showInformationMessage(`Manual export triggered: ${timestamp}`);

      // Workspace storage chatSessions (legacy location)
      // + global emptyWindowChatSessions (new location, VS Code >= early 2026)
      const sessionDirs = [
        ...this.getWorkspaceStoragePaths(this.userHome),
        ...this.getGlobalChatSessionPaths(this.userHome),
      ];
      for (const chatSessionsPath of sessionDirs) {
        if (!fs.existsSync(chatSessionsPath)) continue;
        const sessions = fs.readdirSync(chatSessionsPath);
        for (const sessionFile of sessions) {
          if (this.isCopilotSessionFile(sessionFile)) {
            const fullPath = path.join(chatSessionsPath, sessionFile);
            this.exportChatSession(fullPath, sessionFile);
          }
        }
      }

      // Scan Codex CLI sessions and export to raw/chatgpt-codex/
      const codexSessionsPath = this.getCodexSessionsPath(this.userHome);
      if (fs.existsSync(codexSessionsPath)) {
        this.collectFiles(codexSessionsPath, (filepath) => filepath.endsWith('.jsonl')).forEach((filepath) => {
          this.exportCodexSession(filepath);
        });
      }

      // Scan Copilot Edits (agent mode) sessions and export to raw/copilot-edits/
      for (const stateFile of this.getCopilotEditSessionFiles(this.userHome)) {
        this.exportEditSession(stateFile);
      }

      // Scan Claude Code sessions and export to raw/claude-code/
      const claudeProjectsPath = this.getClaudeProjectsPath(this.userHome);
      if (fs.existsSync(claudeProjectsPath)) {
        this.collectFiles(claudeProjectsPath, (filepath) => filepath.endsWith('.jsonl')).forEach((filepath) => {
          this.exportClaudeSession(filepath);
        });
      }
    } catch (error) {
      vscode.window.showErrorMessage(`Export failed: ${error}`);
    }
  }

  private walkDir(dir: string, callback: (file: string) => void): void {
    if (!fs.existsSync(dir)) return;
    
    fs.readdirSync(dir).forEach(file => {
      const filepath = path.join(dir, file);
      const stat = fs.statSync(filepath);
      if (stat.isDirectory()) {
        this.walkDir(filepath, callback);
      } else {
        callback(filepath);
      }
    });
  }

  private logExportActivity(message: string): void {
    const logPath = path.join(this.exportPath, 'export.log');
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] ${message}\n`;
    fs.appendFileSync(logPath, logEntry, 'utf8');
  }

  private padDate(num: number): string {
    return num.toString().padStart(2, '0');
  }

  private updateStatusBar(): void {
    if (this.isWatching) {
      this.statusBar.text = '$(eye) Wild West: Watching';
      this.statusBar.tooltip = this.createTooltip();
      this.statusBar.show();
    } else {
      this.statusBar.text = '$(eye-closed) Wild West: Stopped';
      this.statusBar.tooltip = this.createTooltip();
      this.statusBar.show();
    }
  }

  private createTooltip(): vscode.MarkdownString {
    const tooltip = new vscode.MarkdownString('', true);
    tooltip.isTrusted = true;
    tooltip.supportHtml = true;

    tooltip.appendMarkdown('**Wild West**\n\n');

    if (this.isWatching) {
      tooltip.appendMarkdown('Status: $(check) Watching\n\n');
      tooltip.appendMarkdown('[$(debug-pause) Stop Watcher](command:wildwest.stopWatcher)\n\n');
    } else {
      tooltip.appendMarkdown('Status: $(circle-slash) Stopped\n\n');
      tooltip.appendMarkdown('[$(play) Start Watcher](command:wildwest.startWatcher)\n\n');
    }

    tooltip.appendMarkdown('---\n\n');
    tooltip.appendMarkdown('[$(sync) Export Now](command:wildwest.exportNow)\n\n');
    tooltip.appendMarkdown('[$(package) Batch Convert to JSON](command:wildwest.batchConvert)\n\n');
    tooltip.appendMarkdown('[$(file-text) Convert to Markdown](command:wildwest.convertToMarkdown)\n\n');
    tooltip.appendMarkdown('[$(list-unordered) Generate Markdown Index](command:wildwest.generateIndex)\n\n');
    tooltip.appendMarkdown('---\n\n');
    tooltip.appendMarkdown('[$(folder-opened) Open Export Folder](command:wildwest.openExportFolder)\n\n');
    tooltip.appendMarkdown('[$(output) View Output Log](command:wildwest.viewOutputLog)\n\n');
    tooltip.appendMarkdown('[$(gear) Settings](command:wildwest.openSettings)\n\n');

    return tooltip;
  }

  async showMenu(): Promise<void> {
    const items: vscode.QuickPickItem[] = [];

    if (this.isWatching) {
      items.push({
        label: '$(debug-pause) Stop Watcher',
        description: 'Stop monitoring chat sessions',
      });
    } else {
      items.push({
        label: '$(play) Start Watcher',
        description: 'Begin monitoring chat sessions',
      });
    }

    items.push(
      {
        label: '$(sync) Export Now',
        description: 'Manually export all current chat sessions',
      },
      {
        label: '$(package) Batch Convert to JSON',
        description: 'Convert all sessions to self-contained replay format',
      },
      {
        label: '$(file-text) Convert to Markdown',
        description: 'Generate Markdown transcripts from exports',
      },
      {
        label: '$(list-unordered) Generate Markdown Index',
        description: 'Create INDEX.md for staged transcripts',
      },
      {
        label: '$(folder-opened) Open Export Folder',
        description: `Open ${this.exportPath}`,
      },
      {
        label: '$(output) View Output Log',
        description: 'Show Wild West output panel',
      },
      {
        label: '$(gear) Settings',
        description: 'Configure Wild West',
      }
    );

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: 'Wild West - Select an action',
    });

    if (!selected) {
      return;
    }

    // Handle selection
    if (selected.label.includes('Stop Watcher')) {
      await this.stop();
    } else if (selected.label.includes('Start Watcher')) {
      await this.start();
    } else if (selected.label.includes('Export Now')) {
      await this.exportNow();
    } else if (selected.label.includes('Batch Convert')) {
      await this.batchConvertSessions();
    } else if (selected.label.includes('Convert to Markdown')) {
      await this.convertExportsToMarkdown();
    } else if (selected.label.includes('Generate Markdown Index')) {
      await this.generateMarkdownIndex();
    } else if (selected.label.includes('Open Export Folder')) {
      vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(this.exportPath));
    } else if (selected.label.includes('View Output Log')) {
      this.outputChannel.show();
    } else if (selected.label.includes('Settings')) {
      vscode.commands.executeCommand('workbench.action.openSettings', 'wildwest');
    }
  }

  public getExportPath(): string {
    return this.exportPath;
  }

  async batchConvertSessions(): Promise<void> {
    try {
      this.log(`${this.getTimestamp()} Starting batch conversion...`);

      if (!fs.existsSync(this.exportPath)) {
        vscode.window.showErrorMessage(`Export directory not found: ${this.exportPath}`);
        return;
      }

      vscode.window.showInformationMessage('Batch converting chat sessions...');

      const converter = new BatchChatConverter(this.exportPath, false);
      await converter.run();

      const stagedDir = path.join(this.exportPath, 'staged');
      this.log(`${this.getTimestamp()} Batch conversion completed`);
      vscode.window.showInformationMessage(
        `✅ Batch conversion complete! Files saved to: ${stagedDir}`,
        'Open Folder'
      ).then((action) => {
        if (action === 'Open Folder') {
          vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(stagedDir));
        }
      });
    } catch (error) {
      this.log(`${this.getTimestamp('error')} Batch conversion failed: ${error}`);
      vscode.window.showErrorMessage(`Batch conversion failed: ${error}`);
    }
  }

  async convertExportsToMarkdown(): Promise<void> {
    try {
      this.log(`${this.getTimestamp()} Starting Markdown conversion...`);

      const stagedDir = path.join(this.exportPath, 'staged');

      if (!fs.existsSync(stagedDir)) {
        vscode.window.showErrorMessage(`Staged directory not found: ${stagedDir}`);
        return;
      }

      vscode.window.showInformationMessage('Converting exports to Markdown...');

      // Find all JSON files in staged directory
      const files = fs.readdirSync(stagedDir);
      const jsonFiles = files.filter((f) => f.endsWith('.json') && !f.startsWith('.'));

      if (jsonFiles.length === 0) {
        vscode.window.showWarningMessage('No JSON files found in staged directory');
        return;
      }

      let converted = 0;
      for (const jsonFile of jsonFiles) {
        const jsonPath = path.join(stagedDir, jsonFile);
        const mdPath = jsonPath.replace('.json', '.md');

        try {
          const outPath = convertJsonFileToMarkdown(jsonPath, mdPath);
          converted++;
          this.log(`${this.getTimestamp()} ✓ Converted to Markdown: ${outPath}`);
        } catch (error) {
          this.log(`${this.getTimestamp('warn')} Failed to convert ${jsonFile}: ${error}`);
        }
      }

      this.log(`${this.getTimestamp()} Markdown conversion completed: ${converted}/${jsonFiles.length}`);
      vscode.window.showInformationMessage(
        `✅ Converted ${converted} file(s) to Markdown!`,
        'Open Folder'
      ).then((action) => {
        if (action === 'Open Folder') {
          vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(stagedDir));
        }
      });
    } catch (error) {
      this.log(`${this.getTimestamp('error')} Markdown conversion failed: ${error}`);
      vscode.window.showErrorMessage(`Markdown conversion failed: ${error}`);
    }
  }

  async generateMarkdownIndex(): Promise<void> {
    try {
      const stagedDir = path.join(this.exportPath, 'staged');
      if (!fs.existsSync(stagedDir)) {
        vscode.window.showErrorMessage(`Staged directory not found: ${stagedDir}`);
        return;
      }

      this.log(`${this.getTimestamp()} Generating Markdown index...`);
      const indexPath = generateIndex(this.exportPath, stagedDir);
      this.log(`${this.getTimestamp()} ✓ Index generated: ${indexPath}`);

      vscode.window
        .showInformationMessage('✅ Markdown index generated!', 'Open INDEX.md')
        .then((action) => {
          if (action === 'Open INDEX.md') {
            vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(indexPath));
          }
        });
    } catch (error) {
      this.log(`${this.getTimestamp('error')} Index generation failed: ${error}`);
      vscode.window.showErrorMessage(`Index generation failed: ${error}`);
    }
  }

  dispose(): void {
    this.saveState();
    this.statusBar.dispose();
    if (this.watcher) {
      this.watcher.close();
    }
  }
}
