import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

jest.mock('vscode', () => ({
  workspace: {
    workspaceFolders: [],
    getConfiguration: () => ({ get: (k: string) => { if (k === 'worldRoot') return process.env.HOME + '/.wildwest-world'; if (k === 'identity') return 'TM'; return undefined; } }),
  },
  window: {
    createWebviewPanel: () => ({}),
    createOutputChannel: () => ({ appendLine: () => {}, show: () => {} }),
  },
}), { virtual: true });

// Mock MCP tools
const mockToolSendWire = jest.fn();
const mockToolAliasExists = jest.fn();
jest.mock('../src/mcp/wwMCPTools', () => ({
  toolDraftWire: jest.fn(),
  toolSendWire: (...args: any[]) => mockToolSendWire(...args),
  toolAliasExists: (...args: any[]) => mockToolAliasExists(...args),
}));

import { TelegraphPanel } from '../src/TelegraphPanel';
import * as vscode from 'vscode'; // mocked

describe('TelegraphPanel alias confirmation flow', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ww-panel-'));
    const ww = path.join(tmp, '.wildwest');
    fs.mkdirSync(ww, { recursive: true });
    fs.writeFileSync(path.join(ww, 'registry.json'), JSON.stringify({ alias: 'local', scope: 'town' }));

    // set workspace folder
    (vscode as any).workspace.workspaceFolders = [{ uri: { fsPath: tmp } }];
  });

  afterEach(() => {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
    mockToolSendWire.mockReset();
    mockToolAliasExists.mockReset();
  });

  function makeFakePanel() {
    const posted: any[] = [];
    const webview: any = {
      html: '',
      postMessage: (m: any) => { posted.push(m); return Promise.resolve(true); },
      onDidReceiveMessage: (h: any) => { webview._handler = h; return { dispose: () => {} }; },
      _handler: null,
    };
    const panel: any = {
      webview,
      onDidDispose: (h: any) => ({ dispose: () => {} }),
      reveal: () => {},
      dispose: () => {},
    };
    return { panel, posted, webview };
  }

  test('prompts for confirmation when alias missing and proceeds on accept', async () => {
    const { panel, posted, webview } = makeFakePanel();
    // monkeypatch createWebviewPanel to return our panel
    (vscode as any).window.createWebviewPanel = jest.fn(() => panel);

    mockToolAliasExists.mockReturnValue(false);
    mockToolSendWire.mockReturnValue({ filename: 'wire.json', path: path.join(tmp, '.wildwest', 'telegraph', 'flat', '1.json'), wwuid: '1', status: 'sent' });

    // open panel (constructs instance)
    TelegraphPanel.open(tmp);

    // simulate send message from webview
    const msg = { type: 'send', to: 'TM[missing-alias]', subject: 'sub', body: 'b', wireType: 'status-update' };
    // call handler
    await webview._handler(msg);

    // first posted message should be aliasConfirm
    const confirm = posted.find((p: any) => p.type === 'aliasConfirm');
    expect(confirm).toBeTruthy();
    const id = confirm.id;

    // simulate user accepting confirmation
    await webview._handler({ type: 'aliasConfirmResponse', id, accept: true });

    // wait a tick for async send to complete
    await new Promise((r) => setTimeout(r, 10));

    const sent = posted.find((p: any) => p.type === 'sent');
    expect(sent).toBeTruthy();
  });

  test('aborts when alias missing and user declines', async () => {
    const { panel, posted, webview } = makeFakePanel();
    (vscode as any).window.createWebviewPanel = jest.fn(() => panel);

    mockToolAliasExists.mockReturnValue(false);

    TelegraphPanel.open(tmp);

    const msg = { type: 'send', to: 'TM[missing-alias]', subject: 'sub', body: 'b', wireType: 'status-update' };
    await webview._handler(msg);

    const confirm = posted.find((p: any) => p.type === 'aliasConfirm');
    expect(confirm).toBeTruthy();
    const id = confirm.id;

    await webview._handler({ type: 'aliasConfirmResponse', id, accept: false });

    await new Promise((r) => setTimeout(r, 10));

    const aborted = posted.find((p: any) => p.type === 'aborted');
    expect(aborted).toBeTruthy();
    const sent = posted.find((p: any) => p.type === 'sent');
    expect(sent).toBeFalsy();
  });
});
