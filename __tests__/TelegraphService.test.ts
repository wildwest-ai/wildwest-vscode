/**
 * TelegraphService.test.ts
 *
 * Unit tests for the shared telegraph primitives in TelegraphService.ts.
 * All tests use os.tmpdir() isolation.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

jest.mock('vscode', () => ({
  workspace: {
    workspaceFolders: [],
  },
}), { virtual: true });

import {
  telegraphTimestamp,
  telegraphISOTimestamp,
  inboxPath,
  outboxPath,
  parseFrontmatter,
  archiveMemo,
  readRegistryAlias,
  getTelegraphDirs,
} from '../src/TelegraphService';

type WorkspaceMock = { workspaceFolders: Array<{ uri: { fsPath: string } }> };

// ---------------------------------------------------------------------------
// telegraphTimestamp
// ---------------------------------------------------------------------------

describe('telegraphTimestamp()', () => {
  it('returns a string in YYYYMMDD-HHMMz format', () => {
    const ts = telegraphTimestamp();
    expect(ts).toMatch(/^\d{8}-\d{4}Z$/);
  });

  it('uses the provided date', () => {
    const d = new Date('2026-05-08T12:34:00.000Z');
    expect(telegraphTimestamp(d)).toBe('20260508-1234Z');
  });

  it('pads single-digit month, day, hour, minute', () => {
    const d = new Date('2026-01-03T09:05:00.000Z');
    expect(telegraphTimestamp(d)).toBe('20260103-0905Z');
  });
});

// ---------------------------------------------------------------------------
// telegraphISOTimestamp
// ---------------------------------------------------------------------------

describe('telegraphISOTimestamp()', () => {
  it('returns ISO 8601 without milliseconds', () => {
    const ts = telegraphISOTimestamp();
    expect(ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });

  it('uses the provided date', () => {
    const d = new Date('2026-05-08T12:34:56.789Z');
    expect(telegraphISOTimestamp(d)).toBe('2026-05-08T12:34:56Z');
  });
});

// ---------------------------------------------------------------------------
// inboxPath / outboxPath
// ---------------------------------------------------------------------------

describe('inboxPath() / outboxPath()', () => {
  it('appends inbox subdirectory', () => {
    expect(inboxPath('/tmp/telegraph')).toBe(path.join('/tmp/telegraph', 'inbox'));
  });

  it('appends outbox subdirectory', () => {
    expect(outboxPath('/tmp/telegraph')).toBe(path.join('/tmp/telegraph', 'outbox'));
  });
});

// ---------------------------------------------------------------------------
// parseFrontmatter
// ---------------------------------------------------------------------------

describe('parseFrontmatter()', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ww-svc-fm-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('parses well-formed frontmatter', () => {
    const file = path.join(tempDir, 'memo.md');
    fs.writeFileSync(file, `---\nto: CD\nfrom: TM\nsubject: hello world\n---\n\nBody`);
    const fm = parseFrontmatter(file);
    expect(fm['to']).toBe('CD');
    expect(fm['from']).toBe('TM');
    expect(fm['subject']).toBe('hello world');
  });

  it('returns {} when file has no frontmatter', () => {
    const file = path.join(tempDir, 'memo.md');
    fs.writeFileSync(file, 'Just a body, no frontmatter');
    expect(parseFrontmatter(file)).toEqual({});
  });

  it('returns {} for a non-existent file', () => {
    expect(parseFrontmatter(path.join(tempDir, 'nonexistent.md'))).toEqual({});
  });

  it('handles values with colons', () => {
    const file = path.join(tempDir, 'memo.md');
    fs.writeFileSync(file, `---\ndate: 2026-05-08T12:34:56Z\n---\n`);
    expect(parseFrontmatter(file)['date']).toBe('2026-05-08T12:34:56Z');
  });
});

// ---------------------------------------------------------------------------
// archiveMemo
// ---------------------------------------------------------------------------

describe('archiveMemo()', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ww-svc-archive-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('moves a file to historyDir', () => {
    const src = path.join(tempDir, 'memo.md');
    fs.writeFileSync(src, 'content');
    const histDir = path.join(tempDir, 'history');

    archiveMemo(src, histDir);

    expect(fs.existsSync(src)).toBe(false);
    expect(fs.existsSync(path.join(histDir, 'memo.md'))).toBe(true);
    expect(fs.readFileSync(path.join(histDir, 'memo.md'), 'utf8')).toBe('content');
  });

  it('creates historyDir if it does not exist', () => {
    const src = path.join(tempDir, 'memo.md');
    fs.writeFileSync(src, 'content');
    const histDir = path.join(tempDir, 'a', 'b', 'history');

    archiveMemo(src, histDir);

    expect(fs.existsSync(histDir)).toBe(true);
    expect(fs.existsSync(path.join(histDir, 'memo.md'))).toBe(true);
  });

  it('throws if src does not exist', () => {
    expect(() =>
      archiveMemo(path.join(tempDir, 'ghost.md'), path.join(tempDir, 'history')),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// readRegistryAlias
// ---------------------------------------------------------------------------

describe('readRegistryAlias()', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ww-svc-reg-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('reads alias from a valid registry.json', () => {
    const wwDir = path.join(tempDir, '.wildwest');
    fs.mkdirSync(wwDir);
    fs.writeFileSync(
      path.join(wwDir, 'registry.json'),
      JSON.stringify({ alias: 'wildwest-vscode', wwuid: 'abc123' }),
    );
    expect(readRegistryAlias(wwDir)).toBe('wildwest-vscode');
  });

  it('returns null if registry.json does not exist', () => {
    expect(readRegistryAlias(path.join(tempDir, '.wildwest'))).toBeNull();
  });

  it('returns null if registry.json has no alias field', () => {
    const wwDir = path.join(tempDir, '.wildwest');
    fs.mkdirSync(wwDir);
    fs.writeFileSync(path.join(wwDir, 'registry.json'), JSON.stringify({ wwuid: 'abc' }));
    expect(readRegistryAlias(wwDir)).toBeNull();
  });

  it('returns null if registry.json is malformed JSON', () => {
    const wwDir = path.join(tempDir, '.wildwest');
    fs.mkdirSync(wwDir);
    fs.writeFileSync(path.join(wwDir, 'registry.json'), '{ bad json }');
    expect(readRegistryAlias(wwDir)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getTelegraphDirs
// ---------------------------------------------------------------------------

describe('getTelegraphDirs()', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ww-svc-dirs-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns telegraph dirs that exist on disk', () => {
    const telegraphDir = path.join(tempDir, '.wildwest', 'telegraph');
    fs.mkdirSync(telegraphDir, { recursive: true });

    (vscode.workspace as unknown as WorkspaceMock).workspaceFolders = [
      { uri: { fsPath: tempDir } },
    ];

    expect(getTelegraphDirs()).toEqual([telegraphDir]);
  });

  it('excludes workspace folders without a telegraph dir', () => {
    (vscode.workspace as unknown as WorkspaceMock).workspaceFolders = [
      { uri: { fsPath: tempDir } }, // no telegraph dir created
    ];
    expect(getTelegraphDirs()).toEqual([]);
  });

  it('returns empty array when workspaceFolders is empty', () => {
    (vscode.workspace as unknown as WorkspaceMock).workspaceFolders = [];
    expect(getTelegraphDirs()).toEqual([]);
  });
});
