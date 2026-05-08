/**
 * TelegraphInbox — rule 23 enforcement
 *
 * Scans all telegraph dirs in the workspace for pending `to-*` memos (not yet
 * acked / archived). Opens each memo in the editor, presents an action picker,
 * writes the ack file (with correct frontmatter + Ref: + Status:), and archives
 * the original to history/.
 *
 * This converts rule 23 from a discipline requirement into a system-enforced
 * workflow. dyads run `wildwest.processInbox` — they cannot skip it silently.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { telegraphTimestamp, archiveMemo, getTelegraphDirs as wwGetTelegraphDirs, parseFrontmatter } from './TelegraphService';

const SKIP_RE = /^\.last-beat$|^\.gitkeep$|--heartbeat--|^ack-|--ack-/;
const TIMESTAMPED_MEMO_RE = /^\d{8}-\d{4}Z-to-.+-from-.+--.+\.md$/;
const LEGACY_TO_MEMO_RE = /^to-.+\.md$/;

// Parse rule-23 filename: <ts>-to-<identity>-from-<identity>--<subject>.md
const PARSE_MEMO_RE = /^(\d{8}-\d{4}Z)-to-(.+?)-from-(.+?)--(.+)\.md$/;

type AckStatus = 'done' | 'blocked' | 'question';

type ActionItem = vscode.QuickPickItem & { value: string };

export class TelegraphInbox {
  constructor(private outputChannel: vscode.OutputChannel) {}

  /**
   * Find all .wildwest/telegraph/ dirs across workspace folders.
   * These are the town-level telegraph buses visible in this workspace.
   */
  getTelegraphDirs(): string[] {
    return wwGetTelegraphDirs();
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

    // Parse frontmatter for rich display — fall back to filename parsing
    const frontmatter = parseFrontmatter(filePath);
    const match = filename.match(PARSE_MEMO_RE);
    const fromIdentity = frontmatter['from'] ?? (match ? match[3] : '?');
    const toIdentity   = frontmatter['to']   ?? (match ? match[2] : '?');
    const subject   = frontmatter['subject'] ?? (match ? match[4].replace(/-/g, ' ') : filename);

    // First line of body as context snippet (skip frontmatter block)
    const bodySnippet = this.readBodySnippet(filePath);

    // Open memo in editor — identity reads before responding
    try {
      const doc = await vscode.workspace.openTextDocument(filePath);
      await vscode.window.showTextDocument(doc, { preview: true, preserveFocus: false });
    } catch {
      this.outputChannel.appendLine(`[TelegraphInbox] could not open ${filename}`);
    }

    const townLabel = this.deriveTownLabel(dir);
    const pickerTitle = `📬 [${townLabel}] From: ${fromIdentity} → ${subject}`;

    const action = await vscode.window.showQuickPick<ActionItem>(
      [
        {
          label: '$(check) Ack Done',
          description: 'consumed — task complete',
          detail: bodySnippet,
          value: 'done',
        },
        {
          label: '$(warning) Ack Blocked',
          description: 'consumed — blocked, add detail',
          value: 'blocked',
        },
        {
          label: '$(question) Ack Question',
          description: 'consumed — need clarification',
          value: 'question',
        },
        {
          label: '$(reply) Reply',
          description: 'send a full response memo to outbox, then archive',
          value: 'reply',
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
        title: pickerTitle,
        placeHolder: `How do you respond? (To: ${toIdentity})`,
        ignoreFocusOut: true,
      },
    );

    if (!action || action.value === 'cancel') {
      return false;
    }
    if (action.value === 'defer') {
      this.outputChannel.appendLine(`[TelegraphInbox] deferred: ${filename}`);
      return true;
    }

    if (action.value === 'reply') {
      return await this.handleReply(dir, filename, match, fromIdentity, toIdentity, subject);
    }

    const status = action.value as AckStatus;
    let comment: string | undefined;

    if (status === 'blocked' || status === 'question') {
      comment = await vscode.window.showInputBox({
        title: status === 'blocked' ? 'What is blocking you?' : 'What is your question?',
        placeHolder: 'One clear sentence...',
        ignoreFocusOut: true,
      });
      comment = comment ?? '';
    }

    await this.writeAckAndArchive(dir, filename, status, comment);
    return true;
  }

  /**
   * Handle the Reply action: compose a full memo to the original sender
   * and archive the original.
   */
  private async handleReply(
    dir: string,
    filename: string,
    match: RegExpMatchArray | null,
    fromIdentity: string,
    toIdentity: string,
    subject: string,
  ): Promise<boolean> {
    const body = await vscode.window.showInputBox({
      title: `Reply to ${fromIdentity} — re: ${subject}`,
      placeHolder: 'Enter your reply (one or more sentences)…',
      ignoreFocusOut: true,
    });
    // undefined = user cancelled the input box — abort reply, don't archive
    if (body === undefined) {
      this.outputChannel.appendLine(`[TelegraphInbox] reply cancelled for ${filename}`);
      return true; // continue inbox, don't stop
    }

    const ts = telegraphTimestamp();
    const reSubject = match ? `re-${match[4]}` : `re-${subject.replace(/\s+/g, '-')}`;
    const replyFilename = `${ts}-to-${fromIdentity}-from-${toIdentity}--${reSubject}.md`;

    const isoNow = new Date().toISOString();
    const replyBody = [
      `---`,
      `from: ${toIdentity}`,
      `to: ${fromIdentity}`,
      `type: reply`,
      `date: ${isoNow}`,
      `subject: ${reSubject}`,
      `---`,
      ``,
      `Ref: ${filename}`,
      ``,
      body,
      ``,
    ].join('\n');

    // Determine outbox path relative to telegraph dir
    const telegraphDir = path.basename(dir) === 'inbox' ? path.dirname(dir) : dir;
    const outboxDir = path.join(telegraphDir, 'outbox');
    fs.mkdirSync(outboxDir, { recursive: true });
    fs.writeFileSync(path.join(outboxDir, replyFilename), replyBody, 'utf-8');

    // Archive original
    archiveMemo(path.join(dir, filename), path.join(dir, 'history'));

    this.outputChannel.appendLine(`[TelegraphInbox] reply queued in outbox: ${replyFilename}`);
    vscode.window.showInformationMessage(`Wild West: reply queued — ${replyFilename}`);
    return true;
  }

  /**
   * Read the first meaningful body line after frontmatter for picker detail display.
   */
  private readBodySnippet(filePath: string): string {
    try {
      const lines = fs.readFileSync(filePath, 'utf8').split('\n');
      let inFrontmatter = false;
      let passedFrontmatter = false;
      for (const line of lines) {
        if (line.trim() === '---') {
          if (!inFrontmatter) { inFrontmatter = true; continue; }
          passedFrontmatter = true; inFrontmatter = false; continue;
        }
        if (inFrontmatter) continue;
        if (!passedFrontmatter && lines[0].trim() !== '---') passedFrontmatter = true;
        const trimmed = line.trim();
        if (trimmed.length > 0) {
          return trimmed.length > 80 ? trimmed.slice(0, 77) + '…' : trimmed;
        }
      }
    } catch { /* ignore */ }
    return '';
  }

  private async writeAckAndArchive(
    dir: string,
    filename: string,
    status: AckStatus,
    comment: string | undefined,
  ): Promise<void> {
    const ts = telegraphTimestamp();
    const match = filename.match(PARSE_MEMO_RE);

    let ackFilename: string;
    let ackBody: string;

    if (match) {
      // match[1]=ts  match[2]=toIdentity  match[3]=fromIdentity  match[4]=subject
      const [, , toIdentity, fromIdentity, subject] = match;
      ackFilename = `${ts}-to-${fromIdentity}-from-${toIdentity}--ack-${status}--${subject}.md`;

      const isoNow = new Date().toISOString();
      const lines = [
        `---`,
        `from: ${toIdentity}`,
        `to: ${fromIdentity}`,
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
    archiveMemo(path.join(dir, filename), path.join(dir, 'history'));

    this.outputChannel.appendLine(`[TelegraphInbox] ack-${status} queued in outbox: ${ackFilename}`);
    vscode.window.showInformationMessage(`Wild West: ack queued — ${ackFilename}`);
  }

  private deriveTownLabel(dir: string): string {
    const telegraphDir = path.basename(dir) === 'inbox' ? path.dirname(dir) : dir;
    return path.basename(path.dirname(path.dirname(telegraphDir)));
  }
}
