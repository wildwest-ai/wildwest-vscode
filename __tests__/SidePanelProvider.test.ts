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

  function writeRegistry(root: string, scope: string, alias: string, wwuid: string): void {
    const wwDir = path.join(root, '.wildwest');
    fs.mkdirSync(wwDir, { recursive: true });
    fs.writeFileSync(
      path.join(wwDir, 'registry.json'),
      JSON.stringify({ scope, alias, wwuid }, null, 2),
      'utf8',
    );
  }

  function writeSessionIndex(exportPath: string, sessions: Record<string, unknown>[]): void {
    const storageDir = path.join(exportPath, 'staged', 'storage');
    fs.mkdirSync(storageDir, { recursive: true });
    fs.writeFileSync(
      path.join(storageDir, 'index.json'),
      JSON.stringify({ schema_version: '1', updated_at: new Date().toISOString(), sessions }, null, 2),
      'utf8',
    );
  }

  function makeSession(id: string, overrides: Record<string, unknown>): Record<string, unknown> {
    const now = new Date().toISOString();
    return {
      wwuid: id,
      wwuid_type: 'session',
      tool: 'ccx',
      tool_sid: id,
      author: 'tester',
      device_id: 'device-1',
      session_type: 'chat',
      recorder_wwuid: '',
      recorder_scope: '',
      workspace_wwuids: [],
      scope_refs: [],
      project_path: '',
      created_at: now,
      last_turn_at: now,
      closed_at: null,
      turn_count: 1,
      ...overrides,
    };
  }

  it('returns 10 root items with correct sectionIds', () => {
    const provider = new SidePanelProvider(mockMonitor);
    const roots = provider.getChildren();
    // Structure: [scopeItem, idItem, Sessions, Utilities, Inbox, Outbox, History, Board, Receipts, hbItem]
    expect(roots).toHaveLength(10);
    expect(roots.map((r) => r.sectionId)).toEqual([
      undefined, undefined, 'sessions', 'utilities', 'inbox', 'outbox', 'history', 'board', 'receipts', undefined,
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

  it('heartbeat root item shows state and last beat timestamp', () => {
    const provider = new SidePanelProvider(mockMonitor);
    // hbItem is the last root item (index 9) — a flat inline item with no sectionId
    const roots = provider.getChildren();
    const hbItem = roots[roots.length - 1] as SidePanelItem;
    expect(hbItem.sectionId).toBeUndefined();
    expect(hbItem.label).toContain('alive');
    expect(hbItem.tooltip).toContain('2026-05-08T12:00:00.000Z');
    provider.dispose();
  });

  it('identity root item shows parsed role and dyad from config', () => {
    const vscode = require('vscode');
    (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
      get: (_key: string, def: unknown) =>
        _key === 'identity' ? 'TM(RHk)' : def,
    });

    const provider = new SidePanelProvider(mockMonitor);
    // idItem is root index 1 — a flat inline item with contextValue 'identity'
    const roots = provider.getChildren();
    const idItem = roots[1] as SidePanelItem;
    expect(idItem.sectionId).toBeUndefined();
    expect(idItem.contextValue).toBe('identity');
    expect(idItem.label).toContain('TM');
    expect(idItem.label).toContain('RHk');
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

  it('filters session counts to the current town by scoped identity before legacy wwuid fallbacks', () => {
    writeRegistry(townRoot, 'town', 'town', 'town-wwuid');
    const exportPath = path.join(tempDir, 'sessions');
    const siblingTown = path.join(tempDir, 'sibling-town');
    writeSessionIndex(exportPath, [
      makeSession('town-path', { project_path: townRoot, turn_count: 2 }),
      makeSession('town-descendant', { project_path: path.join(townRoot, 'packages', 'api'), turn_count: 3 }),
      makeSession('town-wwuid', { workspace_wwuids: ['town-wwuid'], turn_count: 4 }),
      makeSession('town-scope-ref', { scope_refs: [{ scope: 'town', wwuid: 'town-wwuid', alias: 'town', path: townRoot }], turn_count: 5 }),
      makeSession('other-scoped-town', {
        recorder_wwuid: 'other-town-wwuid',
        recorder_scope: 'town',
        workspace_wwuids: ['town-wwuid'],
        scope_refs: [{ scope: 'town', wwuid: 'other-town-wwuid', alias: 'other', path: siblingTown }],
      }),
      makeSession('other-recorder-town', {
        recorder_wwuid: 'other-town-wwuid',
        recorder_scope: 'town',
        workspace_wwuids: ['town-wwuid'],
      }),
      makeSession('sibling-town', { project_path: siblingTown }),
      makeSession('county-root', { project_path: tempDir }),
    ]);

    const provider = new SidePanelProvider(mockMonitor);
    provider.setExportPath(exportPath);
    const sessionsSection = provider.getChildren().find((r) => r.sectionId === 'sessions')!;
    expect(sessionsSection.label).toBe('Sessions (4)');

    const recent = provider.getChildren(sessionsSection).find((r) => r.sectionId === 'sessions:recent')!;
    expect(recent.label).toContain('Recent   4');
    const recentChildren = provider.getChildren(recent);
    expect(recentChildren.find((r) => r.sectionId === 'sessions:today')?.label).toContain('Today   4 (14)');
    provider.dispose();
  });

  it('filters county session counts across scoped county and town identities before legacy fallbacks', () => {
    const countyRoot = path.join(tempDir, 'county');
    const townA = path.join(countyRoot, 'town-a');
    const townB = path.join(countyRoot, 'town-b');
    const outside = path.join(tempDir, 'outside');
    writeRegistry(countyRoot, 'county', 'county', 'county-wwuid');
    writeRegistry(townA, 'town', 'town-a', 'town-a-wwuid');
    writeRegistry(townB, 'town', 'town-b', 'town-b-wwuid');
    const vscode = require('vscode');
    (vscode.workspace as unknown as WorkspaceMock).workspaceFolders = [
      { uri: { fsPath: countyRoot } },
    ];
    (mockMonitor.detectScope as jest.Mock).mockReturnValue('county');

    const exportPath = path.join(tempDir, 'sessions');
    writeSessionIndex(exportPath, [
      makeSession('county-path', { project_path: countyRoot, turn_count: 2 }),
      makeSession('town-path', { project_path: path.join(townA, 'src'), turn_count: 3 }),
      makeSession('town-wwuid', { recorder_wwuid: 'town-b-wwuid', turn_count: 4 }),
      makeSession('county-wwuid', { workspace_wwuids: ['county-wwuid'], turn_count: 5 }),
      makeSession('county-scope-ref', { scope_refs: [{ scope: 'county', wwuid: 'county-wwuid', alias: 'county', path: countyRoot }], turn_count: 6 }),
      makeSession('town-scope-ref', { scope_refs: [{ scope: 'town', wwuid: 'town-a-wwuid', alias: 'town-a', path: townA }], turn_count: 7 }),
      makeSession('other-scoped-town', {
        recorder_wwuid: 'outside-wwuid',
        recorder_scope: 'town',
        workspace_wwuids: ['county-wwuid', 'town-a-wwuid'],
        scope_refs: [{ scope: 'town', wwuid: 'outside-wwuid', alias: 'outside', path: outside }],
      }),
      makeSession('other-recorder-town', {
        recorder_wwuid: 'outside-wwuid',
        recorder_scope: 'town',
        workspace_wwuids: ['county-wwuid', 'town-a-wwuid'],
      }),
      makeSession('outside-path', { project_path: outside }),
      makeSession('outside-wwuid', { recorder_wwuid: 'outside-wwuid' }),
    ]);

    const provider = new SidePanelProvider(mockMonitor);
    provider.setExportPath(exportPath);
    const sessionsSection = provider.getChildren().find((r) => r.sectionId === 'sessions')!;
    expect(sessionsSection.label).toBe('Sessions (6)');

    const recent = provider.getChildren(sessionsSection).find((r) => r.sectionId === 'sessions:recent')!;
    expect(recent.label).toContain('Recent   6');
    const recentChildren = provider.getChildren(recent);
    expect(recentChildren.find((r) => r.sectionId === 'sessions:today')?.label).toContain('Today   6 (27)');
    provider.dispose();
  });
});
