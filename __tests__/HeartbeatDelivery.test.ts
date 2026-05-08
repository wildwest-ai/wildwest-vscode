import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

jest.mock('vscode', () => ({
  workspace: {
    getConfiguration: jest.fn(() => ({
      get: jest.fn((_key: string, defaultValue: unknown) => defaultValue),
    })),
  },
}), { virtual: true });

import { __test__ as HeartbeatMonitorTest } from '../src/HeartbeatMonitor';

describe('HeartbeatMonitor delivery', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wildwest-heartbeat-delivery-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('delivers same-scope town mail into the local inbox and archives the sent copy', () => {
    const townPath = path.join(tempDir, 'counties', 'wildwest-ai', 'wildwest-vscode');
    const telegraphDir = path.join(townPath, '.wildwest', 'telegraph');
    const outboxDir = path.join(telegraphDir, 'outbox');
    const inboxDir = path.join(telegraphDir, 'inbox');
    fs.mkdirSync(outboxDir, { recursive: true });

    const filename = '20260507-2351Z-to-TM(wildwest-vscode)-from-TM(wildwest-vscode)--self-check.md';
    const memo = `---
to: TM
from: TM(wildwest-vscode)
subject: self-check
---

Self-addressed mail should arrive in the local inbox.
`;
    fs.writeFileSync(path.join(outboxDir, filename), memo, 'utf8');

    const logs: string[] = [];
    const outputChannel = {
      appendLine: (message: string) => logs.push(message),
    } as unknown as vscode.OutputChannel;

    const result = HeartbeatMonitorTest.deliverPendingOutbox(
      townPath,
      'town',
      outputChannel,
      tempDir,
      'counties',
    );

    expect(result).toEqual({ delivered: 1, failed: 0 });
    expect(fs.existsSync(path.join(inboxDir, filename))).toBe(true);
    expect(fs.existsSync(path.join(outboxDir, 'history', filename))).toBe(true);
    expect(fs.existsSync(path.join(outboxDir, filename))).toBe(false);
    expect(logs.some((line) => line.includes('/.wildwest/telegraph/inbox/'))).toBe(true);
  });
});
