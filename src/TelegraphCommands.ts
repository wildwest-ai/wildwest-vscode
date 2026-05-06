import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { HeartbeatMonitor } from './HeartbeatMonitor';

export class TelegraphCommands {
  private outputChannel: vscode.OutputChannel;
  private heartbeatMonitor: HeartbeatMonitor;

  constructor(outputChannel: vscode.OutputChannel, heartbeatMonitor?: HeartbeatMonitor) {
    this.outputChannel = outputChannel;
    this.heartbeatMonitor = heartbeatMonitor || ({} as HeartbeatMonitor);
  }

  /**
   * Register telegraph commands
   */
  register(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
      vscode.commands.registerCommand('wildwest.telegraphAck', () => this.ackMemo()),
      vscode.commands.registerCommand('wildwest.telegraphSend', () => this.sendMemo())
    );
  }

  /**
   * Get the active workspace telegraph directory
   */
  private async getTelegraphDir(): Promise<string | null> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      vscode.window.showErrorMessage('No workspace folder open');
      return null;
    }

    const wsPath = workspaceFolders[0].uri.fsPath;
    const telegraphDir = path.join(wsPath, '.wildwest', 'telegraph');

    if (!fs.existsSync(telegraphDir)) {
      vscode.window.showErrorMessage(`Telegraph directory not found: ${telegraphDir}`);
      return null;
    }

    return telegraphDir;
  }

  /**
   * Check if command is allowed in current scope.
   * Telegraph commands are town-scoped only.
   */
  private requireTownScope(): boolean {
    const scope = this.heartbeatMonitor?.detectScope?.();
    if (scope !== 'town') {
      vscode.window.showWarningMessage(`Telegraph commands are only available in town scope. Current scope: ${scope || 'unknown'}`);
      return false;
    }
    return true;
  }

  /**
   * Parse YAML frontmatter from a memo file
   */
  private parseFrontmatter(filePath: string): Record<string, string> {
    const content = fs.readFileSync(filePath, 'utf8');
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    if (!match) return {};

    const fm: Record<string, string> = {};
    const lines = match[1].split('\n');
    for (const line of lines) {
      const [key, ...valueParts] = line.split(':');
      if (key && valueParts.length > 0) {
        fm[key.trim()] = valueParts.join(':').trim();
      }
    }
    return fm;
  }

  /**
   * Get current UTC timestamp in YYYYMMDD-HHMMz format
   */
  private getTimestamp(): string {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return (
      now.getUTCFullYear() +
      pad(now.getUTCMonth() + 1) +
      pad(now.getUTCDate()) +
      '-' +
      pad(now.getUTCHours()) +
      pad(now.getUTCMinutes()) +
      'Z'
    );
  }

  /**
   * Get current UTC timestamp in ISO 8601 format
   */
  private getISO8601Timestamp(): string {
    return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  }

  /**
   * Command: Ack a telegraph memo
   */
  private async ackMemo(): Promise<void> {
    // Enforce town scope for telegraph commands
    if (!this.requireTownScope()) return;

    const telegraphDir = await this.getTelegraphDir();
    if (!telegraphDir) return;

    // Scan inbox/ for unacked inbound memos
    const inboxDir = path.join(telegraphDir, 'inbox');
    if (!fs.existsSync(inboxDir)) {
      vscode.window.showInformationMessage('No inbox directory found');
      return;
    }

    const files = fs.readdirSync(inboxDir);
    const inboundMemos = files.filter((f) => {
      if (f.startsWith('.') || f.includes('ack-')) return false;
      // Match memo pattern: YYYYMMDD-HHMMz-to-* 
      return f.includes('-to-');
    });

    if (inboundMemos.length === 0) {
      vscode.window.showInformationMessage('No unacked memos found in inbox');
      return;
    }

    // Quick pick memo
    const selection = await vscode.window.showQuickPick(
      inboundMemos.map((f) => ({
        label: f,
        description: f.split('--').slice(-1)[0].replace('.md', ''),
      })),
      { placeHolder: 'Select memo to ack' }
    );

    if (!selection) return;

    const originalFileName = selection.label;
    const originalPath = path.join(inboxDir, originalFileName);

    // Parse frontmatter
    const fm = this.parseFrontmatter(originalPath);
    const fromActor = fm['from'];
    const toActor = fm['to'];

    if (!fromActor || !toActor) {
      vscode.window.showErrorMessage('Could not parse memo frontmatter');
      return;
    }

    // Extract subject
    const subjectMatch = originalFileName.match(/--(.+?)\.md$/);
    const subject = subjectMatch ? subjectMatch[1] : 'unknown';

    // Prompt for ack status
    const status = await vscode.window.showQuickPick(
      ['done', 'deferred', 'blocked', 'question'],
      { placeHolder: 'Select ack status' }
    );

    if (!status) return;

    // Optional note
    let note = '';
    if (status === 'question' || status === 'blocked') {
      note = await vscode.window.showInputBox({
        placeHolder: 'Optional note or question (can be blank)',
        prompt: `Add ${status} note:`,
      }) || '';
    }

    // Build ack filename: YYYYMMDD-HHMMZ-to-<FromActor>-from-<ToActor>--ack-<status>--<subject>.md
    const timestamp = this.getTimestamp();
    const ackFileName = `${timestamp}-to-${fromActor}-from-${toActor}--ack-${status}--${subject}.md`;
    const ackPath = path.join(telegraphDir, ackFileName);

    // Build YAML frontmatter
    const isoTimestamp = this.getISO8601Timestamp();
    const frontmatter = `---
from: ${toActor}
to: ${fromActor}
type: ack
status: ${status}
date: ${isoTimestamp}
original_memo: ${originalFileName}
---`;

    // Build body
    let body = '';
    if (status === 'question') {
      body = `# Question\n\n${note || '(Add question here)'}`;
    } else if (status === 'blocked') {
      body = `# Blocked\n\n${note || '(Add blocker details here)'}`;
    } else if (status === 'deferred') {
      body = `# Deferred\n\n${note || ''}`;
    } else {
      body = `# Acknowledged: ${status}`;
    }

    // Write ack file
    const ackContent = `${frontmatter}\n\n${body}\n`;
    fs.writeFileSync(ackPath, ackContent, 'utf8');

    // Archive original to history/YYYY-MM-DD/
    const today = new Date().toISOString().split('T')[0];
    const historyDir = path.join(telegraphDir, 'history', today);
    if (!fs.existsSync(historyDir)) {
      fs.mkdirSync(historyDir, { recursive: true });
    }
    fs.renameSync(originalPath, path.join(historyDir, originalFileName));

    this.outputChannel.appendLine(`[TelegraphCommands] Acked: ${ackFileName}`);
    vscode.window.showInformationMessage(`Acked: ${ackFileName}`);
  }

  /**
   * Command: Send a telegraph memo
   */
  private async sendMemo(): Promise<void> {
    // Enforce town scope for telegraph commands
    if (!this.requireTownScope()) return;

    const telegraphDir = await this.getTelegraphDir();
    if (!telegraphDir) return;

    // Prompt for recipient
    const toActor = await vscode.window.showInputBox({
      placeHolder: 'CD(RSn).Cpt',
      prompt: 'To (Role(Actor)[.Channel]):',
    });

    if (!toActor) return;

    // Prompt for type
    const type = await vscode.window.showQuickPick(
      ['assignment', 'status-update', 'scope-change', 'question', 'incident-report'],
      { placeHolder: 'Select memo type' }
    );

    if (!type) return;

    // Prompt for subject
    const subject = await vscode.window.showInputBox({
      placeHolder: 'my-topic-slug',
      prompt: 'Subject (kebab-case slug):',
    });

    if (!subject) return;

    // Open untitled editor for memo body
    const untitled = await vscode.workspace.openTextDocument({
      language: 'markdown',
      content: `# Memo: ${subject}\n\n(Write memo body here)`,
    });

    await vscode.window.showTextDocument(untitled);

    // Wait for save
    const saveWatcher = vscode.workspace.onDidSaveTextDocument((doc) => {
      if (doc === untitled) {
        saveWatcher.dispose();
        this.finalizeMemo(telegraphDir, toActor, type, subject, doc.getText());
      }
    });

    // Also handle close without save
    const closeWatcher = vscode.window.onDidChangeVisibleTextEditors((editors) => {
      if (!editors.find((e) => e.document === untitled)) {
        closeWatcher.dispose();
        saveWatcher.dispose();
      }
    });
  }

  /**
   * Finalize memo creation
   */
  private finalizeMemo(
    telegraphDir: string,
    toActor: string,
    type: string,
    subject: string,
    body: string
  ): void {
    // Get current actor from workspace (hardcoded for now; could be dynamic)
    const fromActor = 'TM(RHk).Cpt';

    // Build filename: YYYYMMDD-HHMMZ-to-<ToActor>-from-<FromActor>--<subject>.md
    const timestamp = this.getTimestamp();
    const fileName = `${timestamp}-to-${toActor}-from-${fromActor}--${subject}.md`;
    
    // Write to outbox/
    const outboxDir = path.join(telegraphDir, 'outbox');
    if (!fs.existsSync(outboxDir)) {
      fs.mkdirSync(outboxDir, { recursive: true });
    }
    const filePath = path.join(outboxDir, fileName);

    // Build YAML frontmatter
    const isoTimestamp = this.getISO8601Timestamp();
    const frontmatter = `---
from: ${fromActor}
to: ${toActor}
type: ${type}
branch: —
date: ${isoTimestamp}
subject: ${subject}
---`;

    // Extract body (remove the template line)
    const bodyLines = body.split('\n');
    const cleanBody = bodyLines
      .filter((line) => !line.includes('Write memo body here'))
      .join('\n')
      .trim();

    // Write memo file
    const content = `${frontmatter}\n\n${cleanBody}\n`;
    fs.writeFileSync(filePath, content, 'utf8');

    this.outputChannel.appendLine(`[TelegraphCommands] Memo created in outbox: ${fileName}`);
    vscode.window.showInformationMessage(`Memo created in outbox: ${fileName}`);
  }
}
