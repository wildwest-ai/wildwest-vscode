import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { HeartbeatMonitor } from './HeartbeatMonitor';
import { Wire, WireStorageService } from './WireStorageService';
import { generateWwuid } from './sessionPipeline/utils';
import {
  telegraphTimestamp,
  telegraphISOTimestamp,
  parseFrontmatter as parseFrontmatterSvc,
  archiveMemo,
  readRegistryAlias,
} from './TelegraphService';

export class TelegraphCommands {
  private outputChannel: vscode.OutputChannel;
  private heartbeatMonitor: HeartbeatMonitor;
  private wireStorage: WireStorageService | null = null;

  constructor(outputChannel: vscode.OutputChannel, heartbeatMonitor?: HeartbeatMonitor, exportPath?: string) {
    this.outputChannel = outputChannel;
    this.heartbeatMonitor = heartbeatMonitor || ({} as HeartbeatMonitor);
    if (exportPath) {
      this.wireStorage = new WireStorageService(exportPath);
    }
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
    return parseFrontmatterSvc(filePath);
  }

  /**
   * Get current UTC timestamp in YYYYMMDD-HHMMz format
   */
  private getTimestamp(): string {
    return telegraphTimestamp();
  }

  /**
   * Get current UTC timestamp in ISO 8601 format
   */
  private getISO8601Timestamp(): string {
    return telegraphISOTimestamp();
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
    const inboundWires = files.filter((f) => {
      if (f.startsWith('.') || f.includes('ack-')) return false;
      return f.includes('-to-') && (f.endsWith('.json') || f.endsWith('.md'));
    });

    if (inboundWires.length === 0) {
      vscode.window.showInformationMessage('No unacked wires found in inbox');
      return;
    }

    // Quick pick wire
    const selection = await vscode.window.showQuickPick(
      inboundWires.map((f) => ({
        label: f,
        description: f.split('--').slice(-1)[0].replace(/\.(json|md)$/, ''),
      })),
      { placeHolder: 'Select wire to ack' }
    );

    if (!selection) return;

    const originalFileName = selection.label;
    const originalPath = path.join(inboxDir, originalFileName);

    // Parse wire — JSON or legacy MD frontmatter
    let fromActor: string;
    let toActor: string;
    let originalWwuid: string | undefined;
    if (originalFileName.endsWith('.json')) {
      try {
        const wire = JSON.parse(fs.readFileSync(originalPath, 'utf8')) as Partial<Wire>;
        fromActor = wire.from ?? '';
        toActor = wire.to ?? '';
        originalWwuid = wire.wwuid;
      } catch {
        vscode.window.showErrorMessage('Could not parse wire JSON');
        return;
      }
    } else {
      const fm = this.parseFrontmatter(originalPath);
      fromActor = fm['from'] ?? '';
      toActor = fm['to'] ?? '';
    }

    if (!fromActor || !toActor) {
      vscode.window.showErrorMessage('Could not parse wire sender/recipient');
      return;
    }

    // Extract subject
    const subjectMatch = originalFileName.match(/--(.+?)\.(json|md)$/);
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

    const isoTimestamp = this.getISO8601Timestamp();
    const wwuid = generateWwuid('wire', toActor, fromActor, isoTimestamp, `ack-${status}--${subject}`);
    const ackFileName = `${wwuid}.json`;
    const outboxDir = path.join(telegraphDir, 'outbox');
    fs.mkdirSync(outboxDir, { recursive: true });
    const ackPath = path.join(outboxDir, ackFileName);

    let body = '';
    if (status === 'question') {
      body = `Question\n\n${note || '(Add question here)'}`;
    } else if (status === 'blocked') {
      body = `Blocked\n\n${note || '(Add blocker details here)'}`;
    } else if (status === 'deferred') {
      body = `Deferred\n\n${note || ''}`;
    } else {
      body = `Acknowledged: ${status}`;
    }

    const ackWire: Wire = {
      schema_version: '1',
      wwuid,
      wwuid_type: 'wire',
      from: toActor,
      to: fromActor,
      type: 'ack',
      date: isoTimestamp,
      subject: `ack-${status}--${subject}`,
      status: 'sent',
      body,
      filename: ackFileName,
      ack_status: status,
      original_wire: originalFileName,
    };

    fs.writeFileSync(ackPath, JSON.stringify(ackWire, null, 2), 'utf8');

    // Persist to storage and mark original as acked
    if (this.wireStorage) {
      this.wireStorage.write(ackWire);
      if (originalWwuid) {
        this.wireStorage.updateStatus(originalWwuid, 'acked', status);
      }
    }

    // Archive original to inbox/history/
    const today = new Date().toISOString().split('T')[0];
    const historyDir = path.join(inboxDir, 'history', today);
    archiveMemo(originalPath, historyDir);

    this.outputChannel.appendLine(`[TelegraphCommands] Ack queued in outbox: ${ackFileName}`);
    vscode.window.showInformationMessage(`Ack queued: ${ackFileName}`);
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

    // Open untitled editor for wire body
    const untitled = await vscode.workspace.openTextDocument({
      language: 'markdown',
      content: `# Wire: ${subject}\n\n(Write wire body here)`,
    });

    await vscode.window.showTextDocument(untitled);

    // Wait for save
    const saveWatcher = vscode.workspace.onDidSaveTextDocument((doc) => {
      if (doc === untitled) {
        saveWatcher.dispose();
        this.finalizeWire(telegraphDir, toActor, type, subject, doc.getText());
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
   * Finalize wire creation
   */
  private finalizeWire(
    telegraphDir: string,
    toActor: string,
    type: string,
    subject: string,
    body: string
  ): void {
    // Derive sender in Rule-14 format: Role(alias) for multi-town county.
    // Role comes from the wildwest.identity setting; alias from registry.
    const wwRoot = path.dirname(path.dirname(telegraphDir)); // telegraphDir/../.. = wsPath
    const alias = readRegistryAlias(path.join(wwRoot, '.wildwest'));
    const identitySetting = vscode.workspace.getConfiguration('wildwest').get<string>('identity') ?? '';
    const roleMatch = identitySetting.match(/^([A-Za-z]+)/);
    const role = roleMatch ? roleMatch[1] : 'TM';
    const fromActor = alias ? `${role}(${alias})` : (identitySetting || 'TM');

    const isoTimestamp = this.getISO8601Timestamp();
    const wwuid = generateWwuid('wire', fromActor, toActor, isoTimestamp, subject);
    const fileName = `${wwuid}.json`;

    // Write to outbox/
    const outboxDir = path.join(telegraphDir, 'outbox');
    fs.mkdirSync(outboxDir, { recursive: true });
    const filePath = path.join(outboxDir, fileName);

    // Extract body (remove the template line)
    const cleanBody = body.split('\n')
      .filter((line) => !line.includes('Write wire body here'))
      .join('\n')
      .trim();

    const wire: Wire = {
      schema_version: '1',
      wwuid,
      wwuid_type: 'wire',
      from: fromActor,
      to: toActor,
      type,
      date: isoTimestamp,
      subject,
      status: 'sent',
      body: cleanBody,
      filename: fileName,
    };

    fs.writeFileSync(filePath, JSON.stringify(wire, null, 2), 'utf8');

    if (this.wireStorage) {
      this.wireStorage.write(wire);
    }

    this.outputChannel.appendLine(`[TelegraphCommands] Wire created in outbox: ${fileName}`);
    vscode.window.showInformationMessage(`Wire created in outbox: ${fileName}`);
  }

}
