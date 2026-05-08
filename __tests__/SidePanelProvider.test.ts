import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

jest.mock('vscode', () => ({
  TreeItem: class TreeItem {
    label: string;
    collapsibleState: number;
    resourceUri?: unknown;
    command?: unknown;
    tooltip?: string;
    constructor(label: string, collapsibleState: number) {
      this.label = label;
      this.collapsibleState = collapsibleState;
    }
  },
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
  EventEmitter: class EventEmitter {
    event = jest.fn();
    fire = jest.fn();
    dispose = jest.fn();
  },
  Uri: { file: (p: string) => ({ fsPath: p, scheme: 'file' }) },
  ThemeIcon: class ThemeIcon { constructor(public id: string) {} },
  workspace: {
    workspaceFolders: [] as Array<{ uri: { fsPath: string } }>,
    getConfiguration: jest.fn(() => ({
      get: jest.fn((_key: string, def: unknown) => def),
    })),
  },
}), { virtual: true });

import { SidePanelProvider, SidePanelItem } from '../src/SidePanelProvider';
import { HeartbeatMonitor } from '../src/HeartbeatMonitor';

type WorkspaceMock = { workspaceFolders: Array<{ uri: { fsPath: string } }> };

describe('SidePanelProvider', () => {
  let tempDir: string;
  let townRoot: string;
  let telegraphDir: string;
  let inboxDir: string;
  let outboxDir: string;
  let historyDir: string;
  let boardDir: string;
  let mockMonitor: HeartbeatMonitor;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wildwest-sidepanel-'));
    townRoot = path.join(tempDir, 'town');
    telegraphDir = path.join(townRoot, '.wildwest', 'telegraph');
    inboxDir = path.join(telegraphDir, 'inbox');
    outboxDir = path.join(telegraphDir, 'outbox');
    historyDir = path.join(inboxDir, 'history');
    boardDir = path.join(townRoot, '.wildwest', 'board', 'branches');
    fs.mkdirSync(inboxDir, { recursive: true });
    fs.mkdirSync(outboxDir, { recursive: true });
    fs.mkdirSync(historyDir, { recursive: true });
    fs.mkdirSync(boardDir, { recursive: true });
    fs.writeFileSync(path.join(telegraphDir, '.last-beat'), '2026-05-08T12:00:00.000Z\n');

    const vscode = require('vscode');
    (vscode.workspace as unknown as WorkspaceMock).workspaceFolders = [
      { uri: { fsPath: townRoot } },
    ];

    mockMonitor = {
      checkLiveness: jest.fn().mockReturnValue('alive'),
      detectScope: jest.fn().mockReturnValue('town'),
    } as unknown as HeartbeatMonitor;
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    jest.clearAllMocks();
  });

  it('returns 9 root sections with correct sectionIds', () => {
    const provider = new SidePanelProvider(mockMonitor);
    const roots = provider.getChildren();
    expect(roots).toHaveLength(9);
    expect(roots.map((r) => r.sectionId)).toEqual([
      'heartbeat', 'identity', 'sessions', 'utilities', 'inbox', 'outbox', 'history', 'board', 'receipts',
    ]);
    provider.dispose();
  });

  it('inbox section label shows count and children list memo files', () => {
    fs.writeFileSync(path.join(inboxDir, '20260508-1200Z-to-TM-from-CD--task.md'), 'body');
    fs.writeFileSync(path.join(inboxDir, '.gitkeep'), '');

    const provider = new SidePanelProvider(mockMonitor);
    const inboxSection = provider.getChildren().find((r) => r.sectionId === 'inbox')!;
    expect(inboxSection.label).toContain('(1)');

    const children = provider.getChildren(inboxSection);
    expect(children).toHaveLength(1);
    expect((children[0] as SidePanelItem).label).toBe('20260508-1200Z-to-TM-from-CD--task.md');
    provider.dispose();
  });

  it('inbox section shows (empty) when no memos', () => {
    const provider = new SidePanelProvider(mockMonitor);
    const inboxSection = provider.getChildren().find((r) => r.sectionId === 'inbox')!;
    expect(inboxSection.label).toBe('Inbox');

    const children = provider.getChildren(inboxSection);
    expect(children).toHaveLength(1);
    expect((children[0] as SidePanelItem).label).toBe('(empty)');
    provider.dispose();
  });

  it('outbox section lists outbox files', () => {
    fs.writeFileSync(path.join(outboxDir, '20260508-1200Z-to-CD-from-TM--reply.md'), 'body');

    const provider = new SidePanelProvider(mockMonitor);
    const outboxSection = provider.getChildren().find((r) => r.sectionId === 'outbox')!;
    const children = provider.getChildren(outboxSection);
    expect(children).toHaveLength(1);
    expect((children[0] as SidePanelItem).label).toBe('20260508-1200Z-to-CD-from-TM--reply.md');
    provider.dispose();
  });

  it('history section lists archived files from inbox/history/', () => {
    fs.writeFileSync(path.join(historyDir, '20260507-0900Z-to-TM-from-CD--old.md'), 'body');

    const provider = new SidePanelProvider(mockMonitor);
    const histSection = provider.getChildren().find((r) => r.sectionId === 'history')!;
    const children = provider.getChildren(histSection);
    expect(children).toHaveLength(1);
    expect((children[0] as SidePanelItem).label).toBe('20260507-0900Z-to-TM-from-CD--old.md');
    provider.dispose();
  });

  it('board section lists branch docs', () => {
    fs.writeFileSync(path.join(boardDir, 'feat-my-branch.md'), '# branch');

    const provider = new SidePanelProvider(mockMonitor);
    const boardSection = provider.getChildren().find((r) => r.sectionId === 'board')!;
    const children = provider.getChildren(boardSection);
    expect(children).toHaveLength(1);
    expect((children[0] as SidePanelItem).label).toBe('feat-my-branch.md');
    provider.dispose();
  });

  it('board section shows (no branches) when dir is empty', () => {
    const provider = new SidePanelProvider(mockMonitor);
    const boardSection = provider.getChildren().find((r) => r.sectionId === 'board')!;
    const children = provider.getChildren(boardSection);
    expect(children).toHaveLength(1);
    expect((children[0] as SidePanelItem).label).toBe('(no branches)');
    provider.dispose();
  });

  it('receipts section shows pending memos from outbox/', () => {
    fs.writeFileSync(
      path.join(outboxDir, '20260508-1200Z-to-CD-from-TM--review-pr.md'),
      '---\nfrom: TM\nto: CD\n---\n\nBody.\n',
    );
    const provider = new SidePanelProvider(mockMonitor);
    const receiptsSection = provider.getChildren().find((r) => r.sectionId === 'receipts')!;
    expect(receiptsSection.label).toContain('(1)');
    const children = provider.getChildren(receiptsSection);
    expect(children).toHaveLength(1);
    expect((children[0] as SidePanelItem).label).toContain('review-pr');
    expect((children[0] as SidePanelItem).label).toContain('○'); // pending icon
    provider.dispose();
  });

  it('receipts section shows (no sent memos) when outbox is empty', () => {
    const provider = new SidePanelProvider(mockMonitor);
    const receiptsSection = provider.getChildren().find((r) => r.sectionId === 'receipts')!;
    const children = provider.getChildren(receiptsSection);
    expect(children).toHaveLength(1);
    expect((children[0] as SidePanelItem).label).toBe('(no sent memos)');
    provider.dispose();
  });

  it('heartbeat section shows state, scope, town alias, and last beat timestamp', () => {
    const provider = new SidePanelProvider(mockMonitor);
    const hbSection = provider.getChildren().find((r) => r.sectionId === 'heartbeat')!;
    const children = provider.getChildren(hbSection);
    expect(children).toHaveLength(4);
    expect((children[0] as SidePanelItem).label).toContain('alive');
    expect((children[1] as SidePanelItem).label).toContain('town');
    expect((children[2] as SidePanelItem).label).toContain('Town:');
    expect((children[3] as SidePanelItem).label).toContain('2026-05-08T12:00:00.000Z');
    provider.dispose();
  });

  it('identity section shows parsed role and dyad from config', () => {
    const vscode = require('vscode');
    (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
      get: (_key: string, def: unknown) =>
        _key === 'identity' ? 'TM(RHk)' : def,
    });

    const provider = new SidePanelProvider(mockMonitor);
    const identitySection = provider.getChildren().find((r) => r.sectionId === 'identity')!;
    const children = provider.getChildren(identitySection);
    expect(children).toHaveLength(3);
    expect((children[0] as SidePanelItem).label).toContain('Role: TM');
    expect((children[1] as SidePanelItem).label).toContain('dyad: RHk');
    expect((children[2] as SidePanelItem).label).toContain('Edit identity');
    provider.dispose();
  });

  it('refresh() calls fire on the event emitter', () => {
    const provider = new SidePanelProvider(mockMonitor);
    const emitter = (provider as unknown as { _onDidChangeTreeData: { fire: jest.Mock } })._onDidChangeTreeData;
    provider.refresh();
    expect(emitter.fire).toHaveBeenCalledTimes(1);
    provider.dispose();
  });

  it('dispose() clears the auto-refresh interval', () => {
    const spy = jest.spyOn(global, 'clearInterval');
    const provider = new SidePanelProvider(mockMonitor);
    provider.dispose();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
