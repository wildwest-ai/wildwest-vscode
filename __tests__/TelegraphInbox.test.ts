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

    const pending = new TelegraphInbox(outputChannel).getPendingMemos();

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
});
