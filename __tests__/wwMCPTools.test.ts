import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

jest.mock('vscode', () => ({
  workspace: {
    workspaceFolders: [],
  },
}), { virtual: true });

import { toolDraftWire, toolSendWire } from '../src/mcp/wwMCPTools';
import { MCPScopeContext } from '../src/mcp/types';

describe('wwMCP wire write tools', () => {
  let tempDir: string;
  let worldRoot: string;
  let ctx: MCPScopeContext;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ww-mcp-tools-'));
    worldRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ww-world-root-'));

    const wwDir = path.join(tempDir, '.wildwest');
    fs.mkdirSync(wwDir, { recursive: true });
    fs.writeFileSync(
      path.join(wwDir, 'registry.json'),
      JSON.stringify({ alias: 'wildwest-vscode', wwuid: 'abc123' }),
      'utf8',
    );

    ctx = {
      rootPath: tempDir,
      scope: 'town',
      worldRoot,
      countiesDir: 'counties',
    };
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    fs.rmSync(worldRoot, { recursive: true, force: true });
  });

  it('creates a draft wire file and returns a summary', () => {
    const result = toolDraftWire(ctx, {
      to: 'CD(RSn)',
      subject: 'Hello World Subject',
      body: 'This is a draft wire.',
      type: 'status-update',
      re: 'original-wire-wwuid',
    });

    expect(result.status).toBe('draft');
    expect(result.wwuid).toMatch(/^[0-9a-fA-F-]{36}$/);
    expect(result.filename).toContain('hello-world-subject');
    expect(result.path).toContain(path.join('.wildwest', 'telegraph', 'flat'));

    const draftPath = path.join(tempDir, '.wildwest', 'telegraph', 'flat', `${result.wwuid}.json`);
    expect(fs.existsSync(draftPath)).toBe(true);

    const wire = JSON.parse(fs.readFileSync(draftPath, 'utf8'));
    expect(wire.from).toBe('TM(wildwest-vscode)');
    expect(wire.to).toBe('CD(RSn)');
    expect(wire.status).toBe('draft');
    expect(wire.re).toBe('original-wire-wwuid');
  });

  it('creates a sent wire in territory and writes a local outbox copy', () => {
    const result = toolSendWire(ctx, {
      to: 'CD(RSn)',
      subject: 'Wire Subject 123',
      body: 'Send this wire now.',
    });

    expect(result.status).toBe('sent');
    expect(result.filename).toContain('wire-subject-123');
    expect(result.path).toContain(path.join(worldRoot, 'telegraph', 'flat'));

    const territoryPath = path.join(worldRoot, 'telegraph', 'flat', `${result.wwuid}.json`);
    expect(fs.existsSync(territoryPath)).toBe(true);

    const outboxPath = path.join(tempDir, '.wildwest', 'telegraph', 'outbox', result.filename);
    expect(fs.existsSync(outboxPath)).toBe(true);

    const territoryWire = JSON.parse(fs.readFileSync(territoryPath, 'utf8'));
    const outboxWire = JSON.parse(fs.readFileSync(outboxPath, 'utf8'));

    expect(territoryWire.status).toBe('sent');
    expect(outboxWire.status).toBe('sent');
    expect(territoryWire.filename).toBe(outboxWire.filename);
    expect(territoryWire.from).toBe('TM(wildwest-vscode)');
  });

  it('throws when registry alias is missing', () => {
    fs.writeFileSync(
      path.join(tempDir, '.wildwest', 'registry.json'),
      JSON.stringify({ wwuid: 'abc123' }),
      'utf8',
    );

    expect(() => toolDraftWire(ctx, {
      to: 'CD(RSn)',
      subject: 'No Alias',
      body: 'Missing alias test.',
    })).toThrow('Missing registry alias');
  });
});
