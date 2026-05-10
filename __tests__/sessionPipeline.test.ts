import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PacketWriter } from '../src/sessionPipeline/packetWriter';
import { PipelineAdapter } from '../src/sessionPipeline/adapter';
import { SessionPacket } from '../src/sessionPipeline/types';

describe('session pipeline attribution', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wildwest-session-pipeline-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function writeRegistry(root: string, scope: string, wwuid: string): void {
    fs.mkdirSync(path.join(root, '.wildwest'), { recursive: true });
    fs.writeFileSync(
      path.join(root, '.wildwest', 'registry.json'),
      JSON.stringify({ scope, alias: path.basename(root), wwuid }, null, 2),
      'utf8',
    );
  }

  it('persists scoped workspace attribution into session records and index entries', async () => {
    const stagedDir = path.join(tempDir, 'staged');
    const countyRoot = path.join(tempDir, 'county');
    const townRoot = path.join(countyRoot, 'town');
    const writer = new PacketWriter({ stagedDir, author: 'tester', device_id: 'device-1' });
    const packet: SessionPacket = {
      schema_version: '1',
      packet_id: 'packet-1',
      wwuid: 'session-1',
      wwuid_type: 'session',
      tool: 'cpt',
      tool_sid: 'cpt-1',
      author: 'tester',
      device_id: 'device-1',
      seq_from: 0,
      seq_to: 0,
      created_at: '2026-05-09T12:00:00.000Z',
      closed: false,
      turns: [{
        turn_index: 0,
        role: 'user',
        content: 'hello',
        parts: [{ kind: 'text', content: 'hello' }],
        meta: { tool_cursor_value: 'request-1' },
        timestamp: '2026-05-09T12:00:00.000Z',
      }],
    };

    await writer.applyPacketToStorage(
      packet,
      townRoot,
      'chat',
      { type: 'request_id', value: 'request-1' },
      '2026-05-09T12:00:00.000Z',
      'town-wwuid',
      'town',
      ['town-wwuid', 'county-wwuid'],
      [
        { scope: 'town', wwuid: 'town-wwuid', alias: 'town', path: townRoot },
        { scope: 'county', wwuid: 'county-wwuid', alias: 'county', path: countyRoot },
      ],
    );

    const record = JSON.parse(
      fs.readFileSync(path.join(stagedDir, 'storage', 'sessions', 'session-1.json'), 'utf8'),
    );
    const index = JSON.parse(fs.readFileSync(path.join(stagedDir, 'storage', 'index.json'), 'utf8'));
    expect(record.recorder_scope).toBe('town');
    expect(record.workspace_wwuids).toEqual(['town-wwuid', 'county-wwuid']);
    expect(record.scope_refs).toEqual([
      { scope: 'town', wwuid: 'town-wwuid', alias: 'town', path: townRoot },
      { scope: 'county', wwuid: 'county-wwuid', alias: 'county', path: countyRoot },
    ]);
    expect(index.sessions[0].recorder_scope).toBe('town');
    expect(index.sessions[0].workspace_wwuids).toEqual(['town-wwuid', 'county-wwuid']);
    expect(index.sessions[0].scope_refs).toEqual(record.scope_refs);
  });

  it('rebuilds Copilot scoped attribution from raw cwd and content references', () => {
    const sessionsDir = path.join(tempDir, 'sessions');
    const countyRoot = path.join(tempDir, 'county');
    const townRoot = path.join(countyRoot, 'town');
    const otherCountyRoot = path.join(tempDir, 'other-county');
    const otherTownRoot = path.join(otherCountyRoot, 'other-town');
    writeRegistry(countyRoot, 'county', 'county-wwuid');
    writeRegistry(townRoot, 'town', 'town-wwuid');
    writeRegistry(otherCountyRoot, 'county', 'other-county-wwuid');
    writeRegistry(otherTownRoot, 'town', 'other-town-wwuid');
    fs.writeFileSync(path.join(townRoot, 'CLAUDE.md'), '# town\n');
    fs.writeFileSync(path.join(otherTownRoot, 'CLAUDE.md'), '# other town\n');

    const rawDir = path.join(sessionsDir, 'raw', 'github-copilot');
    const storageDir = path.join(sessionsDir, 'staged', 'storage', 'sessions');
    fs.mkdirSync(rawDir, { recursive: true });
    fs.mkdirSync(storageDir, { recursive: true });

    fs.writeFileSync(
      path.join(rawDir, 'copilot-session.json'),
      JSON.stringify({
        version: 1,
        creationDate: Date.parse('2026-05-09T12:00:00.000Z'),
        sessionId: 'copilot-session',
        requests: [
          {
            requestId: 'request-1',
            timestamp: Date.parse('2026-05-09T12:00:00.000Z'),
            message: { text: 'work on town' },
            contentReferences: [
              { reference: { fsPath: path.join(townRoot, 'CLAUDE.md') } },
              { reference: { fsPath: path.join(otherTownRoot, 'CLAUDE.md') } },
            ],
            response: [
              { value: 'ok', toolSpecificData: { cwd: townRoot } },
              { value: 'still ok', toolSpecificData: { cwd: townRoot } },
            ],
          },
        ],
      }),
      'utf8',
    );

    fs.writeFileSync(
      path.join(storageDir, 'session-1.json'),
      JSON.stringify({
        schema_version: '1',
        wwuid: 'session-1',
        wwuid_type: 'session',
        tool: 'cpt',
        tool_sid: 'copilot-session',
        author: 'tester',
        device_id: 'device-1',
        session_type: 'chat',
        recorder_wwuid: '',
        recorder_scope: '',
        workspace_wwuids: ['other-town-wwuid', 'other-county-wwuid'],
        scope_refs: [
          { scope: 'town', wwuid: 'other-town-wwuid', alias: 'other-town', path: otherTownRoot },
          { scope: 'county', wwuid: 'other-county-wwuid', alias: 'other-county', path: otherCountyRoot },
        ],
        project_path: countyRoot,
        created_at: '2026-05-09T12:00:00.000Z',
        last_turn_at: '2026-05-09T12:00:00.000Z',
        closed_at: null,
        cursor: { type: 'request_id', value: 'request-1' },
        turn_count: 1,
        turns: [],
      }, null, 2),
      'utf8',
    );

    const adapter = new PipelineAdapter({
      sessionsDir,
      author: 'tester',
      projectPath: townRoot,
      recorderWwuid: 'town-wwuid',
    });
    expect(adapter.rebuildIndexFromRecords()).toBe(1);

    const record = JSON.parse(fs.readFileSync(path.join(storageDir, 'session-1.json'), 'utf8'));
    const index = JSON.parse(fs.readFileSync(path.join(sessionsDir, 'staged', 'storage', 'index.json'), 'utf8'));
    expect(record.project_path).toBe(townRoot);
    expect(record.workspace_wwuids).toEqual(['town-wwuid', 'county-wwuid', 'other-town-wwuid', 'other-county-wwuid']);
    expect(record.scope_refs).toEqual(expect.arrayContaining([
      expect.objectContaining({ scope: 'town', wwuid: 'town-wwuid', path: townRoot, signal_count: 3 }),
      expect.objectContaining({ scope: 'county', wwuid: 'county-wwuid', path: countyRoot, signal_count: 3 }),
      expect.objectContaining({ scope: 'town', wwuid: 'other-town-wwuid', path: otherTownRoot, signal_count: 1 }),
      expect.objectContaining({ scope: 'county', wwuid: 'other-county-wwuid', path: otherCountyRoot, signal_count: 1 }),
    ]));
    expect(index.sessions[0].workspace_wwuids).toEqual(['town-wwuid', 'county-wwuid', 'other-town-wwuid', 'other-county-wwuid']);
    expect(index.sessions[0].scope_refs).toEqual(expect.arrayContaining([
      expect.objectContaining({ scope: 'town', wwuid: 'town-wwuid', path: townRoot, signal_count: 3 }),
      expect.objectContaining({ scope: 'county', wwuid: 'county-wwuid', path: countyRoot, signal_count: 3 }),
      expect.objectContaining({ scope: 'town', wwuid: 'other-town-wwuid', path: otherTownRoot, signal_count: 1 }),
      expect.objectContaining({ scope: 'county', wwuid: 'other-county-wwuid', path: otherCountyRoot, signal_count: 1 }),
    ]));
  });
});
