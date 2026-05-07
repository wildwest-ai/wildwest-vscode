/**
 * TelegraphInbox — rule 23 enforcement
 *
 * Scans all telegraph dirs in the workspace for pending `to-*` memos (not yet
 * acked / archived). Opens each memo in the editor, presents an action picker,
 * writes the ack file (with correct frontmatter + Ref: + Status:), and archives
 * the original to history/.
 *
 * This converts rule 23 from a discipline requirement into a system-enforced
 * workflow. devPairs run `wildwest.processInbox` — they cannot skip it silently.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

const SKIP_RE = /^\.last-beat$|^\.gitkeep$|--heartbeat--|^ack-|--ack-/;
const TIMESTAMPED_MEMO_RE = /^\d{8}-\d{4}Z-to-.+-from-.+--.+\.md$/;
const LEGACY_TO_MEMO_RE = /^to-.+\.md$/;

// Parse rule-23 filename: <ts>-to-<actor>-from-<actor>--<subject>.md
const PARSE_MEMO_RE = /^(\d{8}-\d{4}Z)-to-(.+?)-from-(.+?)--(.+)\.md$/;

type AckStatus = 'done' | 'blocked' | 'question';

type ActionItem = vscode.QuickPickItem & { value: string };

function nowTs(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}Z`
  );
}

export class TelegraphInbox {
  constructor(private outputChannel: vscode.OutputChannel) {}

  /**
   * Find all .wildwest/telegraph/ dirs across workspace folders.
   * These are the town-level telegraph buses visible in this workspace.
   */
  getTelegraphDirs(): string[] {
    const dirs: string[] = [];
    for (const f of vscode.workspace.workspaceFolders ?? []) {
      const dir = path.join(f.uri.fsPath, '.wildwest', 'telegraph');
      if (fs.existsSync(dir)) {
        dirs.push(dir);
      }
    }
    return dirs;
  }

  /**
   * Return all pending (unacked, un-archived) memos across all telegraph inboxes.
   * Also scans the bus root as a migration fallback for pre-v2 flat memos.
   */
  getPendingMemos(): Array<{ dir: string; filename: string }> {
    const result: Array<{ dir: string; filename: string }> = [];
    for (const telegraphDir of this.getTelegraphDirs()) {
      const inboxDir = path.join(telegraphDir, 'inbox');
      if (fs.existsSync(inboxDir)) {
        result.push(...this.listPendingMemos(inboxDir));
      }

      // Migration fallback: pre-v2 flat memos may still live in telegraph root.
      result.push(...this.listPendingMemos(telegraphDir));
    }
    return result;
  }

  private listPendingMemos(dir: string): Array<{ dir: string; filename: string }> {
    const result: Array<{ dir: string; filename: string }> = [];
    let entries: string[];
    try {
      entries = fs.readdirSync(dir);
    } catch {
      return result;
    }
    for (const f of entries.sort()) {
      if (this.isPendingMemoFilename(f)) {
        result.push({ dir, filename: f });
      }
    }
    return result;
  }

  private isPendingMemoFilename(filename: string): boolean {
    if (!filename.endsWith('.md')) return false;
    if (filename.startsWith('.') || filename.startsWith('!')) return false;
    if (SKIP_RE.test(filename)) return false;
    return TIMESTAMPED_MEMO_RE.test(filename) || LEGACY_TO_MEMO_RE.test(filename);
  }

  /**
   * Interactive inbox: open each pending memo in the editor, present an action
   * picker, write the ack, archive the original. Stops on cancel or when all
   * memos are processed.
   */
  async processInbox(): Promise<void> {
    const pending = this.getPendingMemos();
    if (pending.length === 0) {
      vscode.window.showInformationMessage('Wild West: inbox clear — no pending memos.');
      return;
    }

    this.outputChannel.appendLine(`[TelegraphInbox] ${pending.length} pending memo(s)`);

    for (const { dir, filename } of pending) {
      const cont = await this.processMemo(dir, filename);
      if (!cont) {
        break;
      }
    }
  }

  private async processMemo(dir: string, filename: string): Promise<boolean> {
    const filePath = path.join(dir, filename);

    // Open memo in editor — actor reads before responding
    try {
      const doc = await vscode.workspace.openTextDocument(filePath);
      await vscode.window.showTextDocument(doc, { preview: true, preserveFocus: false });
    } catch {
      this.outputChannel.appendLine(`[TelegraphInbox] could not open ${filename}`);
    }

    const townLabel = this.deriveTownLabel(dir);

    const action = await vscode.window.showQuickPick<ActionItem>(
      [
        {
          label: '$(check) Ack Done',
          description: 'memo consumed — task complete',
          value: 'done',
        },
        {
          label: '$(warning) Ack Blocked',
          description: 'memo consumed — blocked, add detail',
          value: 'blocked',
        },
        {
          label: '$(question) Ack Question',
          description: 'memo consumed — need clarification',
          value: 'question',
        },
        {
          label: '$(debug-step-over) Defer',
          description: 'skip this memo for now',
          value: 'defer',
        },
        {
          label: '$(x) Stop processing',
          description: 'exit inbox',
          value: 'cancel',
        },
      ],
      {
        title: `📬 [${townLabel}] ${filename}`,
        placeHolder: 'How do you respond to this memo?',
        ignoreFocusOut: true, // stays visible while actor reads the open doc
      },
    );

    if (!action || action.value === 'cancel') {
      return false;
    }
    if (action.value === 'defer') {
      this.outputChannel.appendLine(`[TelegraphInbox] deferred: ${filename}`);
      return true;
    }

    const status = action.value as AckStatus;
    let comment: string | undefined;

    if (status === 'blocked' || status === 'question') {
      comment = await vscode.window.showInputBox({
        title: status === 'blocked' ? 'What is blocking you?' : 'What is your question?',
        placeHolder: 'One clear sentence...',
        ignoreFocusOut: true,
      });
      // undefined = user escaped — treat as empty string, still write the ack
      comment = comment ?? '';
    }

    await this.writeAckAndArchive(dir, filename, status, comment);
    return true;
  }

  private async writeAckAndArchive(
    dir: string,
    filename: string,
    status: AckStatus,
    comment: string | undefined,
  ): Promise<void> {
    const ts = nowTs();
    const match = filename.match(PARSE_MEMO_RE);

    let ackFilename: string;
    let ackBody: string;

    if (match) {
      // match[1]=ts  match[2]=toActor  match[3]=fromActor  match[4]=subject
      const [, , toActor, fromActor, subject] = match;
      ackFilename = `${ts}-to-${fromActor}-from-${toActor}--ack-${status}--${subject}.md`;

      const isoNow = new Date().toISOString();
      const lines = [
        `---`,
        `from: ${toActor}`,
        `to: ${fromActor}`,
        `type: ack-${status}`,
        `branch: —`,
        `date: ${isoNow}`,
        `subject: ack-${status}--${subject}`,
        `---`,
        ``,
        `Ref: ${filename}`,
        `Status: ${status}`,
      ];
      if (comment) {
        lines.push(``, status === 'blocked' ? `Blocked: ${comment}` : `Question: ${comment}`);
      }
      ackBody = lines.join('\n') + '\n';
    } else {
      // Filename doesn't match expected pattern — write a best-effort ack
      ackFilename = `${ts}-ack-${status}--${filename}`;
      ackBody = `Ref: ${filename}\nStatus: ${status}\n${comment ? `\nNote: ${comment}\n` : ''}`;
      this.outputChannel.appendLine(
        `[TelegraphInbox] warning: filename did not match rule-23 pattern — ${filename}`,
      );
    }

    // Write ack to outbox so the delivery operator can route it.
    const telegraphDir = path.basename(dir) === 'inbox' ? path.dirname(dir) : dir;
    const outboxDir = path.join(telegraphDir, 'outbox');
    fs.mkdirSync(outboxDir, { recursive: true });
    fs.writeFileSync(path.join(outboxDir, ackFilename), ackBody, 'utf-8');

    // Archive original → history/
    const historyDir = path.join(dir, 'history');
    fs.mkdirSync(historyDir, { recursive: true });
    fs.renameSync(path.join(dir, filename), path.join(historyDir, filename));

    this.outputChannel.appendLine(`[TelegraphInbox] ack-${status} queued in outbox: ${ackFilename}`);
    vscode.window.showInformationMessage(`Wild West: ack queued — ${ackFilename}`);
  }

  private deriveTownLabel(dir: string): string {
    const telegraphDir = path.basename(dir) === 'inbox' ? path.dirname(dir) : dir;
    return path.basename(path.dirname(path.dirname(telegraphDir)));
  }
}
