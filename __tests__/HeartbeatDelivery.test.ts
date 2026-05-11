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
  commands: {
    executeCommand: jest.fn(() => Promise.resolve()),
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

  it('marks the flat/ SSOT JSON wire delivered when the outbox file is processed', () => {
    const townPath = path.join(tempDir, 'counties', 'wildwest-ai', 'wildwest-vscode');
    const telegraphDir = path.join(townPath, '.wildwest', 'telegraph');
    const outboxDir = path.join(telegraphDir, 'outbox');
    const inboxDir = path.join(telegraphDir, 'inbox');
    const flatDir = path.join(tempDir, 'telegraph', 'flat');
    fs.mkdirSync(outboxDir, { recursive: true });
    fs.mkdirSync(flatDir, { recursive: true });

    const filename = '20260507-2351Z-to-TM(wildwest-vscode)-from-TM(wildwest-vscode)--self-check.json';
    const memo = {
      filename,
      to: 'TM',
      from: 'TM(wildwest-vscode)',
      subject: 'self-check',
      body: 'Self-addressed mail should arrive in the local inbox.',
      status: 'pending',
    };
    fs.writeFileSync(path.join(outboxDir, filename), JSON.stringify(memo, null, 2), 'utf8');
    fs.writeFileSync(path.join(flatDir, filename), JSON.stringify(memo, null, 2), 'utf8');

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

    const flatWire = JSON.parse(fs.readFileSync(path.join(flatDir, filename), 'utf8')) as Record<string, unknown>;
    expect(flatWire.status).toBe('delivered');
    expect(typeof flatWire.delivered_at).toBe('string');
    expect(Array.isArray(flatWire.status_transitions)).toBe(true);
    expect((flatWire.status_transitions as Array<Record<string, unknown>>).some((t) => t.status === 'delivered')).toBe(true);
    expect(logs.some((line) => line.includes('flat wire updated'))).toBe(true);
  });

  it('creates a territory flat wire entry when the wire is absent from SSOT', () => {
    const townPath = path.join(tempDir, 'counties', 'wildwest-ai', 'wildwest-vscode');
    const countyPath = path.join(tempDir, 'counties', 'wildwest-ai');
    const telegraphDir = path.join(townPath, '.wildwest', 'telegraph');
    const outboxDir = path.join(telegraphDir, 'outbox');
    const countyInboxDir = path.join(countyPath, '.wildwest', 'telegraph', 'inbox');
    const flatDir = path.join(tempDir, 'telegraph', 'flat');
    fs.mkdirSync(outboxDir, { recursive: true });

    const filename = '20260511-0030Z-to-CD(RSn)-from-TM(wildwest-vscode).Cld--release-v0.37.6.json';
    const memo = {
      schema_version: '2',
      wwuid: 'wire-release-v0.37.6-20260511-0030Z',
      wwuid_type: 'wire',
      from: 'TM(wildwest-vscode).Cld',
      to: 'CD(RSn)',
      type: 'status-update',
      date: '2026-05-11T00:30:00Z',
      subject: 'release v0.37.6',
      status: 'pending',
      body: 'Release note wire for v0.37.6.',
      filename,
    };
    fs.writeFileSync(path.join(outboxDir, filename), JSON.stringify(memo, null, 2), 'utf8');

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
    expect(fs.existsSync(path.join(countyInboxDir, filename))).toBe(true);
    expect(fs.existsSync(path.join(outboxDir, 'history', filename))).toBe(true);
    expect(fs.existsSync(path.join(flatDir, filename))).toBe(true);

    const flatWire = JSON.parse(fs.readFileSync(path.join(flatDir, filename), 'utf8')) as Record<string, unknown>;
    expect(flatWire.status).toBe('delivered');
    expect(typeof flatWire.delivered_at).toBe('string');
    expect(Array.isArray(flatWire.status_transitions)).toBe(true);
    expect((flatWire.status_transitions as Array<Record<string, unknown>>).some((t) => t.status === 'delivered')).toBe(true);
    expect(logs.some((line) => line.includes('flat wire created'))).toBe(true);
  });

  it('beats TM(wildwest-vscode).Cld → CD(RSn) and delivers it to the parent county inbox', () => {
    const worldRoot = tempDir;
    const countyPath = path.join(worldRoot, 'counties', 'wildwest-ai');
    const townPath = path.join(countyPath, 'wildwest-vscode');
    const outboxDir = path.join(townPath, '.wildwest', 'telegraph', 'outbox');
    const countyInboxDir = path.join(countyPath, '.wildwest', 'telegraph', 'inbox');

    fs.mkdirSync(outboxDir, { recursive: true });
    fs.mkdirSync(path.join(countyPath, '.wildwest'), { recursive: true });

    fs.writeFileSync(
      path.join(townPath, '.wildwest', 'registry.json'),
      JSON.stringify({ scope: 'town', alias: 'wildwest-vscode', wwuid: 'town-uid' }, null, 2),
      'utf8',
    );
    fs.writeFileSync(
      path.join(countyPath, '.wildwest', 'registry.json'),
      JSON.stringify({ scope: 'county', alias: 'wildwest-ai', wwuid: 'county-uid' }, null, 2),
      'utf8',
    );

    const filename = '20260510-1819Z-to-CD(RSn)-from-TM(wildwest-vscode).Cld--bug.json';
    const memo = {
      schema_version: '2',
      wwuid: 'ba474482-7c6b-57d2-8476-314dcf4a523e',
      wwuid_type: 'wire',
      from: 'TM(wildwest-vscode).Cld',
      to: 'CD(RSn)',
      type: 'status-update',
      date: '2026-05-10T18:19:00Z',
      subject: 'bug reproduction',
      status: 'pending',
      body: 'Reproducing county delivery bug',
      filename,
    };
    fs.writeFileSync(path.join(outboxDir, filename), JSON.stringify(memo, null, 2), 'utf8');

    const logs: string[] = [];
    const outputChannel = {
      appendLine: (message: string) => logs.push(message),
    } as unknown as vscode.OutputChannel;

    const state = HeartbeatMonitorTest.beatTown(townPath, outputChannel, worldRoot, 'counties');

    expect(state).toBe('alive');
    expect(fs.existsSync(path.join(countyInboxDir, filename))).toBe(true);
    expect(fs.existsSync(path.join(outboxDir, 'history', filename))).toBe(true);
    expect(logs.some((line) => line.includes('normalized'))).toBe(true);
    expect(logs.some((line) => line.includes(`delivery: ${filename}`))).toBe(true);
  });

  it('delivers exact town alias TM(wildwest-vscode) from county outbox without ambiguous normalization', () => {
    const worldRoot = tempDir;
    const countyPath = path.join(worldRoot, 'counties', 'wildwest-ai');
    const townAPath = path.join(countyPath, 'wildwest-vscode');
    const townBPath = path.join(countyPath, 'other-town');
    const outboxDir = path.join(countyPath, '.wildwest', 'telegraph', 'outbox');
    const townAInboxDir = path.join(townAPath, '.wildwest', 'telegraph', 'inbox');

    fs.mkdirSync(outboxDir, { recursive: true });
    fs.mkdirSync(path.join(townAPath, '.wildwest'), { recursive: true });
    fs.mkdirSync(path.join(townBPath, '.wildwest'), { recursive: true });

    fs.writeFileSync(
      path.join(townAPath, '.wildwest', 'registry.json'),
      JSON.stringify({ scope: 'town', alias: 'wildwest-vscode', wwuid: 'town-a-uid' }, null, 2),
      'utf8',
    );
    fs.writeFileSync(
      path.join(townBPath, '.wildwest', 'registry.json'),
      JSON.stringify({ scope: 'town', alias: 'other-town', wwuid: 'town-b-uid' }, null, 2),
      'utf8',
    );
    fs.writeFileSync(
      path.join(countyPath, '.wildwest', 'registry.json'),
      JSON.stringify({ scope: 'county', alias: 'wildwest-ai', wwuid: 'county-uid' }, null, 2),
      'utf8',
    );

    const filename = '20260510-1900Z-to-TM(wildwest-vscode)-from-CD--route.json';
    const memo = {
      schema_version: '2',
      wwuid: 'route-check',
      wwuid_type: 'wire',
      from: 'CD',
      to: 'TM(wildwest-vscode)',
      type: 'status-update',
      date: '2026-05-10T19:00:00Z',
      subject: 'route exact town alias',
      status: 'pending',
      body: 'Route to one town exactly.',
      filename,
    };
    fs.writeFileSync(path.join(outboxDir, filename), JSON.stringify(memo, null, 2), 'utf8');

    const logs: string[] = [];
    const outputChannel = {
      appendLine: (message: string) => logs.push(message),
    } as unknown as vscode.OutputChannel;

    const result = HeartbeatMonitorTest.deliverPendingOutbox(countyPath, 'county', outputChannel, worldRoot, 'counties');

    expect(result).toEqual({ delivered: 1, failed: 0 });
    expect(fs.existsSync(path.join(townAInboxDir, filename))).toBe(true);
    expect(fs.existsSync(path.join(outboxDir, 'history', filename))).toBe(true);
    expect(logs.some((line) => line.includes('role=TM'))).toBe(true);
    expect(logs.some((line) => line.includes('pattern=wildwest-vscode'))).toBe(true);
  });

  it('beatTown sends TM->CD wires into parent county inbox and logs the delivery path', () => {
    const worldRoot = tempDir;
    const countyPath = path.join(worldRoot, 'counties', 'wildwest-ai');
    const townPath = path.join(countyPath, 'wildwest-vscode');
    const outboxDir = path.join(townPath, '.wildwest', 'telegraph', 'outbox');
    const countyInboxDir = path.join(countyPath, '.wildwest', 'telegraph', 'inbox');

    fs.mkdirSync(outboxDir, { recursive: true });
    fs.mkdirSync(path.join(countyPath, '.wildwest'), { recursive: true });

    fs.writeFileSync(
      path.join(townPath, '.wildwest', 'registry.json'),
      JSON.stringify({ scope: 'town', alias: 'wildwest-vscode', wwuid: 'town-uid' }, null, 2),
      'utf8',
    );
    fs.writeFileSync(
      path.join(countyPath, '.wildwest', 'registry.json'),
      JSON.stringify({ scope: 'county', alias: 'wildwest-ai', wwuid: 'county-uid' }, null, 2),
      'utf8',
    );

    const filename = '20260510-0000Z-to-CD-from-TM--test.json';
    const memo = {
      schema_version: '2',
      wwuid: 'bug-wire',
      wwuid_type: 'wire',
      from: 'TM',
      to: 'CD',
      type: 'status-update',
      date: '2026-05-10T00:00:00Z',
      subject: 'county delivery test',
      status: 'sent',
      body: 'Test TM to CD delivery',
      filename,
    };
    fs.writeFileSync(path.join(outboxDir, filename), JSON.stringify(memo, null, 2), 'utf8');

    const logs: string[] = [];
    const outputChannel = {
      appendLine: (message: string) => logs.push(message),
    } as unknown as vscode.OutputChannel;

    const state = HeartbeatMonitorTest.beatTown(townPath, outputChannel, worldRoot, 'counties');

    expect(state).toBe('alive');
    expect(fs.existsSync(path.join(countyInboxDir, filename))).toBe(true);
    expect(fs.existsSync(path.join(outboxDir, 'history', filename))).toBe(true);
    expect(logs.some((line) => line.includes(`town beat countyRoot=${countyPath}`))).toBe(true);
    expect(logs.some((line) => line.includes(`delivery: ${filename}`))).toBe(true);
  });
});
