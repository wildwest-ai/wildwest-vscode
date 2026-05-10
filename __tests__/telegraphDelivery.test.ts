import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as vscode from 'vscode';

/**
 * Test suite for telegraph delivery operator (deliverPendingOutbox).
 *
 * Uses the production implementation exported via HeartbeatMonitor.__test__
 * instead of a local stub. This exercises the real delivery code paths.
 *
 * Scenarios:
 * 1. Happy path — memo delivered to county inbox
 * 2. Unknown destination role — memo marked failed (!prefix), not in inbox
 * 3. Empty outbox — no-op, returns 0 delivered
 * 4. Local destination (same scope) — delivers into local inbox
 * 5. Invalid role format — memo marked failed
 * 6. Missing 'to:' field — memo marked failed
 */

jest.mock('vscode', () => ({
  workspace: {
    getConfiguration: jest.fn(() => ({
      get: jest.fn((_key: string, defaultValue: unknown) => defaultValue),
    })),
  },
}), { virtual: true });

import { __test__ as HeartbeatMonitorTest } from '../src/HeartbeatMonitor';

function makeOutputChannel(logs: string[]): vscode.OutputChannel {
  return { appendLine: (msg: string) => logs.push(msg) } as unknown as vscode.OutputChannel;
}

describe('Telegraph Delivery — production deliverPendingOutbox', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'telegraph-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function deliver(townPath: string, worldRoot: string, countiesDir = 'counties') {
    const logs: string[] = [];
    const oc = makeOutputChannel(logs);
    const result = HeartbeatMonitorTest.deliverPendingOutbox(
      townPath, 'town', oc, worldRoot, countiesDir,
    );
    return { result, logs };
  }

  test('Happy path — memo delivered to county inbox', () => {
    const worldRoot = tempDir;
    const countyPath = path.join(worldRoot, 'counties', 'mycounty');
    const townPath = path.join(countyPath, 'mytown');
    fs.mkdirSync(path.join(townPath, '.wildwest', 'telegraph', 'outbox'), { recursive: true });

    const filename = '20260508-1200Z-to-CD-from-TM--test.json';
    const memoContent = JSON.stringify({
      schema_version: '2',
      wwuid: 'test-wire',
      wwuid_type: 'wire',
      from: 'TM',
      to: 'CD',
      type: 'status-update',
      date: '2026-05-08T12:00:00Z',
      subject: 'test',
      status: 'sent',
      body: 'Test memo',
      filename,
    }, null, 2);
    fs.writeFileSync(
      path.join(townPath, '.wildwest', 'telegraph', 'outbox', filename),
      memoContent,
    );

    const { result, logs } = deliver(townPath, worldRoot);

    expect(result.delivered).toBe(1);
    expect(result.failed).toBe(0);
    expect(logs.some((l) => l.includes('delivery:'))).toBe(true);

    expect(fs.existsSync(path.join(countyPath, '.wildwest', 'telegraph', 'inbox', filename))).toBe(true);
    const historyPath = path.join(townPath, '.wildwest', 'telegraph', 'outbox', 'history', filename);
    expect(fs.existsSync(historyPath)).toBe(true);
    const archivedJson = JSON.parse(fs.readFileSync(historyPath, 'utf8')) as Record<string, unknown>;
    expect(archivedJson.delivered_at).toBeTruthy();
  });

  test('JSON wire — memo delivered to county inbox', () => {
    const worldRoot = tempDir;
    const countyPath = path.join(worldRoot, 'counties', 'mycounty');
    const townPath = path.join(countyPath, 'mytown');
    fs.mkdirSync(path.join(townPath, '.wildwest', 'telegraph', 'outbox'), { recursive: true });

    const filename = '20260508-1200Z-to-CD-from-TM--test.json';
    const wire = {
      schema_version: '2',
      wwuid: 'test-wire',
      wwuid_type: 'wire',
      from: 'TM',
      to: 'CD',
      type: 'status-update',
      date: '2026-05-08T12:00:00Z',
      subject: 'test',
      status: 'sent',
      body: 'Test memo',
      filename,
    };
    fs.writeFileSync(
      path.join(townPath, '.wildwest', 'telegraph', 'outbox', filename),
      JSON.stringify(wire, null, 2),
      'utf8',
    );

    const { result, logs } = deliver(townPath, worldRoot);

    expect(result.delivered).toBe(1);
    expect(result.failed).toBe(0);
    expect(logs.some((l) => l.includes('delivery:'))).toBe(true);
    expect(fs.existsSync(path.join(countyPath, '.wildwest', 'telegraph', 'inbox', filename))).toBe(true);
    const historyPath = path.join(townPath, '.wildwest', 'telegraph', 'outbox', 'history', filename);
    expect(fs.existsSync(historyPath)).toBe(true);
    expect(JSON.parse(fs.readFileSync(historyPath, 'utf8')).delivered_at).toBeTruthy();
  });

  test('Unknown role — memo marked failed, not delivered', () => {
    const worldRoot = tempDir;
    const townPath = path.join(worldRoot, 'counties', 'myc', 'mytown');
    fs.mkdirSync(path.join(townPath, '.wildwest', 'telegraph', 'outbox'), { recursive: true });

    const filename = '20260508-1200Z-to-BOGUS-from-TM--test.json';
    fs.writeFileSync(
      path.join(townPath, '.wildwest', 'telegraph', 'outbox', filename),
      JSON.stringify({
        schema_version: '2',
        wwuid: 'bogus-wire',
        wwuid_type: 'wire',
        from: 'TM',
        to: 'BOGUS',
        type: 'status-update',
        date: '2026-05-08T12:00:00Z',
        subject: 'test',
        status: 'sent',
        body: 'Test',
        filename,
      }, null, 2),
    );

    const { result, logs } = deliver(townPath, worldRoot);

    expect(result.delivered).toBe(0);
    expect(result.failed).toBe(1);
    expect(logs.some((l) => l.includes('unknown role'))).toBe(true);
    // Production renames to !<filename> on failure
    expect(fs.existsSync(path.join(townPath, '.wildwest', 'telegraph', 'outbox', `!${filename}`))).toBe(true);
    expect(fs.existsSync(path.join(townPath, '.wildwest', 'telegraph', 'outbox', filename))).toBe(false);
  });

  test('Empty outbox — no-op', () => {
    const worldRoot = tempDir;
    const townPath = path.join(worldRoot, 'counties', 'myc', 'mytown');
    fs.mkdirSync(path.join(townPath, '.wildwest', 'telegraph', 'outbox'), { recursive: true });

    const { result } = deliver(townPath, worldRoot);

    expect(result.delivered).toBe(0);
    expect(result.failed).toBe(0);
  });

  test('Local (same-scope) destination — delivered to local inbox', () => {
    const worldRoot = tempDir;
    const townPath = path.join(worldRoot, 'counties', 'myc', 'mytown');
    fs.mkdirSync(path.join(townPath, '.wildwest', 'telegraph', 'outbox'), { recursive: true });

    // HG is town-only in SCOPE_ROLES → same scope → local delivery
    const filename = '20260508-1200Z-to-HG-from-TM--local.json';
    fs.writeFileSync(
      path.join(townPath, '.wildwest', 'telegraph', 'outbox', filename),
      JSON.stringify({
        schema_version: '2',
        wwuid: 'local-wire',
        wwuid_type: 'wire',
        from: 'TM',
        to: 'HG',
        type: 'status-update',
        date: '2026-05-08T12:00:00Z',
        subject: 'local',
        status: 'sent',
        body: 'Local',
        filename,
      }, null, 2),
    );

    const { result, logs } = deliver(townPath, worldRoot);

    expect(result.delivered).toBe(1);
    expect(logs.some((l) => l.includes('inbox'))).toBe(true);
    expect(fs.existsSync(path.join(townPath, '.wildwest', 'telegraph', 'inbox', filename))).toBe(true);
  });

  test('Missing to: field — memo marked failed', () => {
    const worldRoot = tempDir;
    const townPath = path.join(worldRoot, 'counties', 'myc', 'mytown');
    fs.mkdirSync(path.join(townPath, '.wildwest', 'telegraph', 'outbox'), { recursive: true });

    const filename = '20260508-1200Z-to-MISSING-from-TM--no-to.json';
    fs.writeFileSync(
      path.join(townPath, '.wildwest', 'telegraph', 'outbox', filename),
      JSON.stringify({
        schema_version: '2',
        wwuid: 'missing-to-wire',
        wwuid_type: 'wire',
        from: 'TM',
        type: 'status-update',
        date: '2026-05-08T12:00:00Z',
        subject: 'test',
        status: 'sent',
        body: 'No to field',
        filename,
      }, null, 2),
    );

    const { result, logs } = deliver(townPath, worldRoot);

    expect(result.delivered).toBe(0);
    expect(result.failed).toBe(1);
    expect(logs.some((l) => l.includes("missing 'to:' field"))).toBe(true);
  });

  test('Invalid role format — memo marked failed', () => {
    const worldRoot = tempDir;
    const townPath = path.join(worldRoot, 'counties', 'myc', 'mytown');
    fs.mkdirSync(path.join(townPath, '.wildwest', 'telegraph', 'outbox'), { recursive: true });

    const filename = '20260508-1200Z-to-INVALID-from-TM--bad-role.json';
    fs.writeFileSync(
      path.join(townPath, '.wildwest', 'telegraph', 'outbox', filename),
      JSON.stringify({
        schema_version: '2',
        wwuid: 'invalid-role-wire',
        wwuid_type: 'wire',
        from: 'TM',
        to: '(BadRole)',
        type: 'status-update',
        date: '2026-05-08T12:00:00Z',
        subject: 'Test',
        status: 'sent',
        body: 'Test',
        filename,
      }, null, 2),
    );

    const { result, logs } = deliver(townPath, worldRoot);

    expect(result.delivered).toBe(0);
    expect(result.failed).toBe(1);
    expect(logs.some((l) => l.includes('invalid addressing format') || l.includes('FAILED'))).toBe(true);
  });
});
