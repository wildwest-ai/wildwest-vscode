import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

jest.mock('vscode', () => ({
  workspace: {
    workspaceFolders: [],
    openTextDocument: jest.fn(),
  },
  window: {
    showTextDocument: jest.fn(),
    showInformationMessage: jest.fn(),
    showQuickPick: jest.fn(),
    showInputBox: jest.fn(),
  },
}), { virtual: true });

import { TelegraphInbox } from '../src/TelegraphInbox';

type WorkspaceMock = {
  workspaceFolders: Array<{ uri: { fsPath: string } }>;
};

type InboxPrivate = {
  writeAckAndArchive(
    dir: string,
    filename: string,
    status: 'done' | 'blocked' | 'question',
    comment: string | undefined,
  ): Promise<void>;
  readBodySnippet(filePath: string): string;
  handleReply(
    dir: string,
    filename: string,
    match: RegExpMatchArray | null,
    fromActor: string,
    toActor: string,
    subject: string,
  ): Promise<boolean>;
};

describe('TelegraphInbox', () => {
  let tempDir: string;
  let townRoot: string;
  let telegraphDir: string;
  let inboxDir: string;
  let outboxDir: string;
  let outputChannel: vscode.OutputChannel;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wildwest-telegraph-inbox-'));
    townRoot = path.join(tempDir, 'wildwest-vscode');
    telegraphDir = path.join(townRoot, '.wildwest', 'telegraph');
    inboxDir = path.join(telegraphDir, 'inbox');
    outboxDir = path.join(telegraphDir, 'outbox');
    fs.mkdirSync(inboxDir, { recursive: true });
    fs.mkdirSync(outboxDir, { recursive: true });

    (vscode.workspace as unknown as WorkspaceMock).workspaceFolders = [
      { uri: { fsPath: townRoot } },
    ];
    outputChannel = {
      appendLine: jest.fn(),
    } as unknown as vscode.OutputChannel;
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('finds timestamped delivered memos in inbox', () => {
    const memo = '20260507-2253Z-to-TM(wildwest-vscode)-from-CD--review.md';
    fs.writeFileSync(path.join(inboxDir, memo), 'memo');
    fs.writeFileSync(path.join(telegraphDir, '20260507-2253Z-to-TM-from-CD--legacy.md'), 'legacy');
    fs.writeFileSync(path.join(inboxDir, '20260507-2253Z-to-CD-from-TM--ack-done--review.md'), 'ack');

    const pending = new TelegraphInbox(outputChannel).getPendingWires();

    expect(pending).toEqual([
      { dir: inboxDir, filename: memo },
      { dir: telegraphDir, filename: '20260507-2253Z-to-TM-from-CD--legacy.md' },
    ]);
  });

  it('queues ack files to outbox and archives the original inbox memo', async () => {
    const memo = '20260507-2253Z-to-TM-from-CD--review.md';
    fs.writeFileSync(path.join(inboxDir, memo), 'memo');

    const inbox = new TelegraphInbox(outputChannel) as unknown as InboxPrivate;
    await inbox.writeAckAndArchive(inboxDir, memo, 'done', undefined);

    const outboxFiles = fs.readdirSync(outboxDir).filter((f) => f.endsWith('.md'));
    expect(outboxFiles).toHaveLength(1);
    expect(outboxFiles[0]).toMatch(/^\d{8}-\d{4}Z-to-CD-from-TM--ack-done--review\.md$/);
    expect(fs.existsSync(path.join(inboxDir, 'history', memo))).toBe(true);
    expect(fs.existsSync(path.join(inboxDir, memo))).toBe(false);
  });

  // ── readBodySnippet ─────────────────────────────────────────────────────

  describe('readBodySnippet', () => {
    it('returns first non-empty body line after frontmatter', () => {
      const p = path.join(inboxDir, 'memo.md');
      fs.writeFileSync(p, '---\nfrom: CD\nto: TM\n---\n\nThis is the body.\n');
      const inbox = new TelegraphInbox(outputChannel) as unknown as InboxPrivate;
      expect(inbox.readBodySnippet(p)).toBe('This is the body.');
    });

    it('truncates long lines at 80 chars', () => {
      const longLine = 'x'.repeat(100);
      const p = path.join(inboxDir, 'memo.md');
      fs.writeFileSync(p, `---\nfrom: CD\n---\n\n${longLine}\n`);
      const inbox = new TelegraphInbox(outputChannel) as unknown as InboxPrivate;
      const snippet = inbox.readBodySnippet(p);
      expect(snippet.length).toBeLessThanOrEqual(80);
      expect(snippet.endsWith('…')).toBe(true);
    });

    it('returns empty string for a file with only frontmatter', () => {
      const p = path.join(inboxDir, 'memo.md');
      fs.writeFileSync(p, '---\nfrom: CD\nto: TM\n---\n');
      const inbox = new TelegraphInbox(outputChannel) as unknown as InboxPrivate;
      expect(inbox.readBodySnippet(p)).toBe('');
    });

    it('returns empty string for a missing file', () => {
      const inbox = new TelegraphInbox(outputChannel) as unknown as InboxPrivate;
      expect(inbox.readBodySnippet(path.join(inboxDir, 'nonexistent.md'))).toBe('');
    });
  });

  // ── handleReply ─────────────────────────────────────────────────────────

  describe('handleReply', () => {
    const filename = '20260508-1200Z-to-TM-from-CD--important-task.md';
    const match = filename.match(/^(\d{8}-\d{4}Z)-to-(.+?)-from-(.+?)--(.+)\.md$/)!;

    beforeEach(() => {
      fs.writeFileSync(path.join(inboxDir, filename), '---\nfrom: CD\nto: TM\n---\n\nBody.\n');
    });

    it('writes reply memo to outbox and archives original when body entered', async () => {
      (vscode.window.showInputBox as jest.Mock).mockResolvedValueOnce('My reply text.');

      const inbox = new TelegraphInbox(outputChannel) as unknown as InboxPrivate;
      const result = await inbox.handleReply(inboxDir, filename, match, 'CD', 'TM', 'important task');

      expect(result).toBe(true);
      const outboxFiles = fs.readdirSync(outboxDir).filter((f) => f.endsWith('.md'));
      expect(outboxFiles).toHaveLength(1);
      expect(outboxFiles[0]).toMatch(/to-CD-from-TM--re-important-task/);
      const replyBody = fs.readFileSync(path.join(outboxDir, outboxFiles[0]), 'utf8');
      expect(replyBody).toContain('My reply text.');
      expect(replyBody).toContain(`Ref: ${filename}`);
      expect(replyBody).toContain('type: reply');
      // Original archived
      expect(fs.existsSync(path.join(inboxDir, 'history', filename))).toBe(true);
    });

    it('does not archive original when user cancels input box', async () => {
      (vscode.window.showInputBox as jest.Mock).mockResolvedValueOnce(undefined);

      const inbox = new TelegraphInbox(outputChannel) as unknown as InboxPrivate;
      const result = await inbox.handleReply(inboxDir, filename, match, 'CD', 'TM', 'important task');

      expect(result).toBe(true); // continue inbox, don't stop
      expect(fs.existsSync(path.join(inboxDir, filename))).toBe(true); // not archived
      expect(fs.readdirSync(outboxDir).filter((f) => f.endsWith('.md'))).toHaveLength(0);
    });

    it('includes empty-string body when user clears input', async () => {
      (vscode.window.showInputBox as jest.Mock).mockResolvedValueOnce('');

      const inbox = new TelegraphInbox(outputChannel) as unknown as InboxPrivate;
      await inbox.handleReply(inboxDir, filename, match, 'CD', 'TM', 'important task');

      const outboxFiles = fs.readdirSync(outboxDir).filter((f) => f.endsWith('.md'));
      expect(outboxFiles).toHaveLength(1);
    });
  });
});
