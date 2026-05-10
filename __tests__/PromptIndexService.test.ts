import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PromptIndexService } from '../src/PromptIndexService';

describe('PromptIndexService', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wildwest-prompts-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function writeSession(fileName: string, record: Record<string, unknown>): void {
    const sessionsDir = path.join(tempDir, 'staged', 'storage', 'sessions');
    fs.mkdirSync(sessionsDir, { recursive: true });
    fs.writeFileSync(path.join(sessionsDir, fileName), JSON.stringify(record, null, 2), 'utf8');
  }

  it('filters terminal output and ranks reusable framework-compliant prompts above authorization snippets', async () => {
    writeSession('session-1.json', {
      wwuid: 'session-1',
      tool: 'cld',
      recorder_scope: 'town',
      workspace_wwuids: ['town-1', 'county-1'],
      scope_refs: [
        { scope: 'town', wwuid: 'town-1', alias: 'wildwest-vscode', path: '/town' },
        { scope: 'county', wwuid: 'county-1', alias: 'wildwest-ai', path: '/county' },
      ],
      last_turn_at: '2026-05-10T12:04:00.000Z',
      turns: [
        {
          turn_index: 0,
          role: 'user',
          content: '› Metro waiting on exp+wildwest://dev-client/?url=http://127.0.0.1:8081',
          timestamp: '2026-05-10T12:00:00.000Z',
        },
        {
          turn_index: 1,
          role: 'user',
          content: 'Declare your model and version, run `date`, set the chat title, then run cold start.',
          timestamp: '2026-05-10T12:01:00.000Z',
        },
        {
          turn_index: 2,
          role: 'user',
          content: 'R>C: authorized push',
          timestamp: '2026-05-10T12:02:00.000Z',
        },
        {
          turn_index: 3,
          role: 'user',
          content: 'Implement prompt index ranking so suggestions align with scope and Wild West framework rules.',
          timestamp: '2026-05-10T12:03:00.000Z',
        },
      ],
    });

    const service = new PromptIndexService(tempDir);
    await service.buildIndex(true);
    const index = service.getIndex();
    expect(index?.schema_version).toBe('3');
    expect(index?.analytics.raw_total).toBe(4);
    expect(index?.analytics.filtered_noise).toBe(1);
    expect(index?.analytics.by_kind.session_bootstrap).toBe(1);
    expect(index?.analytics.by_kind.authorization).toBe(1);

    const prompts = index?.prompts ?? [];
    expect(prompts.find(p => p.content.includes('Metro waiting'))).toBeUndefined();

    const bootstrap = prompts.find(p => p.kind === 'session_bootstrap');
    const authorization = prompts.find(p => p.kind === 'authorization');
    expect(bootstrap?.framework_compliant).toBe(true);
    expect(authorization?.score).toBeLessThan(bootstrap?.score ?? 0);
  });

  it('preserves scope lineage and avoids blind global fallback for scoped searches', async () => {
    writeSession('town-session.json', {
      wwuid: 'town-session',
      tool: 'cpt',
      recorder_scope: 'town',
      workspace_wwuids: ['town-1', 'county-1'],
      scope_refs: [
        { scope: 'town', wwuid: 'town-1', alias: 'wildwest-vscode', path: '/county/wildwest-vscode' },
        { scope: 'county', wwuid: 'county-1', alias: 'wildwest-ai', path: '/county' },
      ],
      last_turn_at: '2026-05-10T12:00:00.000Z',
      turns: [{
        turn_index: 0,
        role: 'user',
        content: 'Review the prompt completion UX for the town side panel.',
        timestamp: '2026-05-10T12:00:00.000Z',
      }],
    });
    writeSession('county-session.json', {
      wwuid: 'county-session',
      tool: 'cld',
      recorder_scope: 'county',
      workspace_wwuids: ['county-1'],
      scope_refs: [
        { scope: 'county', wwuid: 'county-1', alias: 'wildwest-ai', path: '/county' },
      ],
      last_turn_at: '2026-05-10T12:01:00.000Z',
      turns: [{
        turn_index: 0,
        role: 'user',
        content: 'Review county law changes for prompt governance.',
        timestamp: '2026-05-10T12:01:00.000Z',
      }],
    });

    const service = new PromptIndexService(tempDir);
    await service.buildIndex(true);

    expect(service.search('Review', [], 10)).toHaveLength(2);
    expect(service.search('Review', 'missing-scope', 10)).toEqual([]);

    const townOnly = service.search('Review', 'wildwest-vscode', 10);
    expect(townOnly).toHaveLength(1);
    expect(townOnly[0].scope_alias).toBe('wildwest-vscode');
    expect(townOnly[0].scope_lineage).toContain('wildwest-ai');

    const cascaded = service.search('Review', ['wildwest-vscode', 'wildwest-ai'], 10);
    expect(cascaded.map(p => p.scope_alias).sort()).toEqual(['wildwest-ai', 'wildwest-vscode']);
  });

  it('flags stale framework terminology and routing-shaped addresses', async () => {
    writeSession('session-1.json', {
      wwuid: 'session-1',
      tool: 'cpt',
      recorder_scope: 'town',
      workspace_wwuids: ['town-1'],
      scope_refs: [
        { scope: 'town', wwuid: 'town-1', alias: 'wildwest-vscode', path: '/town' },
      ],
      last_turn_at: '2026-05-10T12:00:00.000Z',
      turns: [{
        turn_index: 0,
        role: 'user',
        content: 'Send memo to: TM(RHk) from: CD(RSn). The devPair should monitor /Users/reneyap/Dev/work.',
        timestamp: '2026-05-10T12:00:00.000Z',
      }],
    });

    const service = new PromptIndexService(tempDir);
    await service.buildIndex(true);

    const prompt = service.getIndex()?.prompts[0];
    expect(prompt?.framework_compliant).toBe(false);
    expect(prompt?.compliance_flags).toEqual(expect.arrayContaining([
      'pre_v1_devpair_term',
      'dyad_in_telegraph_address',
      'identity_scope_collision',
      'nonportable_path_or_session_artifact',
    ]));
  });
});
