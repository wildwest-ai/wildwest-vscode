jest.mock('vscode', () => ({
  workspace: { workspaceFolders: [] },
  window: {
    showErrorMessage: jest.fn(),
    showWarningMessage: jest.fn(),
    showInformationMessage: jest.fn(),
  },
}), { virtual: true });

import { validateRegistryData, validateRegistryFile } from '../src/RegistryValidator';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// ---------------------------------------------------------------------------
// validateRegistryData — field-level validation
// ---------------------------------------------------------------------------

describe('validateRegistryData', () => {
  const valid = {
    wwuid: '83b09a8d-6587-46bb-9e98-880d56db39b2',
    alias: 'wildwest-vscode',
    scope: 'town',
    remote: 'https://github.com/wildwest-ai/wildwest-vscode',
    mcp: null,
    actors: [{ role: 'TM', identity: 'RHk', channel: 'main' }],
  };

  it('passes a fully valid registry', () => {
    const result = validateRegistryData(valid);
    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('passes with no optional fields', () => {
    const result = validateRegistryData({ wwuid: valid.wwuid, alias: valid.alias, scope: 'county' });
    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  // ── wwuid ────────────────────────────────────────────────────────────────

  it('errors when wwuid is missing', () => {
    const { wwuid: _, ...rest } = valid;
    const result = validateRegistryData(rest);
    expect(result.valid).toBe(false);
    expect(result.issues).toContainEqual(expect.objectContaining({ field: 'wwuid', severity: 'error' }));
  });

  it('errors when wwuid is not a string', () => {
    const result = validateRegistryData({ ...valid, wwuid: 12345 });
    expect(result.valid).toBe(false);
    expect(result.issues).toContainEqual(expect.objectContaining({ field: 'wwuid', severity: 'error' }));
  });

  it('warns when wwuid is not UUID format', () => {
    const result = validateRegistryData({ ...valid, wwuid: 'not-a-uuid' });
    // still valid (warn, not error)
    expect(result.valid).toBe(true);
    expect(result.issues).toContainEqual(expect.objectContaining({ field: 'wwuid', severity: 'warn' }));
  });

  // ── alias ────────────────────────────────────────────────────────────────

  it('errors when alias is missing', () => {
    const { alias: _, ...rest } = valid;
    const result = validateRegistryData(rest);
    expect(result.valid).toBe(false);
    expect(result.issues).toContainEqual(expect.objectContaining({ field: 'alias', severity: 'error' }));
  });

  it('errors when alias is empty string', () => {
    const result = validateRegistryData({ ...valid, alias: '' });
    expect(result.valid).toBe(false);
    expect(result.issues).toContainEqual(expect.objectContaining({ field: 'alias', severity: 'error' }));
  });

  // ── scope ────────────────────────────────────────────────────────────────

  it('errors when scope is missing', () => {
    const { scope: _, ...rest } = valid;
    const result = validateRegistryData(rest);
    expect(result.valid).toBe(false);
    expect(result.issues).toContainEqual(expect.objectContaining({ field: 'scope', severity: 'error' }));
  });

  it('errors when scope is an invalid value', () => {
    const result = validateRegistryData({ ...valid, scope: 'village' });
    expect(result.valid).toBe(false);
    expect(result.issues).toContainEqual(expect.objectContaining({ field: 'scope', severity: 'error' }));
  });

  it('accepts all valid scope values', () => {
    for (const scope of ['town', 'county', 'territory']) {
      const result = validateRegistryData({ ...valid, scope });
      expect(result.valid).toBe(true);
    }
  });

  // ── remote ───────────────────────────────────────────────────────────────

  it('warns when remote is a number', () => {
    const result = validateRegistryData({ ...valid, remote: 42 });
    expect(result.valid).toBe(true); // warn, not error
    expect(result.issues).toContainEqual(expect.objectContaining({ field: 'remote', severity: 'warn' }));
  });

  it('accepts remote as null', () => {
    const result = validateRegistryData({ ...valid, remote: null });
    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('accepts remote absent', () => {
    const { remote: _, ...rest } = valid;
    const result = validateRegistryData(rest);
    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  // ── mcp ──────────────────────────────────────────────────────────────────

  it('warns when mcp is an array', () => {
    const result = validateRegistryData({ ...valid, mcp: [] });
    expect(result.valid).toBe(true);
    expect(result.issues).toContainEqual(expect.objectContaining({ field: 'mcp', severity: 'warn' }));
  });

  it('accepts mcp as null', () => {
    const result = validateRegistryData({ ...valid, mcp: null });
    expect(result.valid).toBe(true);
  });

  // ── actors ───────────────────────────────────────────────────────────────

  it('errors when actors is not an array', () => {
    const result = validateRegistryData({ ...valid, actors: 'bad' });
    expect(result.valid).toBe(false);
    expect(result.issues).toContainEqual(expect.objectContaining({ field: 'actors', severity: 'error' }));
  });

  it('errors when identity entry is missing required fields', () => {
    const result = validateRegistryData({ ...valid, actors: [{ role: 'TM' }] });
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.field.startsWith('actors[0]') && i.severity === 'error')).toBe(true);
  });

  it('warns when identity role is invalid for scope', () => {
    // scope=town, valid roles: Mayor, TM, HG — "CD" is county-only
    const result = validateRegistryData({ ...valid, scope: 'town', actors: [{ role: 'CD', identity: 'RSn', channel: 'main' }] });
    expect(result.valid).toBe(true); // warn, not error
    expect(result.issues).toContainEqual(
      expect.objectContaining({ field: 'actors[0].role', severity: 'warn' }),
    );
  });

  it('does not warn on unknown scope when checking identity roles', () => {
    // scope is invalid (already errored), but should not double-warn on role
    const result = validateRegistryData({ ...valid, scope: 'unknown', actors: [{ role: 'X', identity: 'Y', channel: 'main' }] });
    const roleWarn = result.issues.find((i) => i.field === 'actors[0].role' && i.severity === 'warn');
    expect(roleWarn).toBeUndefined();
  });

  it('accepts empty actors array', () => {
    const result = validateRegistryData({ ...valid, actors: [] });
    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('collects multiple errors', () => {
    const result = validateRegistryData({ remote: null });
    expect(result.valid).toBe(false);
    expect(result.issues.filter((i) => i.severity === 'error').length).toBeGreaterThanOrEqual(3);
  });
});

// ---------------------------------------------------------------------------
// validateRegistryFile — file I/O layer
// ---------------------------------------------------------------------------

describe('validateRegistryFile', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ww-registry-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('errors when file does not exist', () => {
    const result = validateRegistryFile(path.join(tmpDir, 'missing.json'));
    expect(result.valid).toBe(false);
    expect(result.issues[0].severity).toBe('error');
    expect(result.issues[0].message).toMatch(/not found/);
  });

  it('errors when file is not valid JSON', () => {
    const p = path.join(tmpDir, 'registry.json');
    fs.writeFileSync(p, 'not json');
    const result = validateRegistryFile(p);
    expect(result.valid).toBe(false);
    expect(result.issues[0].message).toMatch(/not valid JSON/);
  });

  it('errors when root is an array', () => {
    const p = path.join(tmpDir, 'registry.json');
    fs.writeFileSync(p, '[]');
    const result = validateRegistryFile(p);
    expect(result.valid).toBe(false);
    expect(result.issues[0].message).toMatch(/root must be a JSON object/);
  });

  it('returns valid for a well-formed file', () => {
    const p = path.join(tmpDir, 'registry.json');
    fs.writeFileSync(p, JSON.stringify({
      wwuid: '83b09a8d-6587-46bb-9e98-880d56db39b2',
      alias: 'test-town',
      scope: 'town',
    }));
    const result = validateRegistryFile(p);
    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('passes issues through from validateRegistryData', () => {
    const p = path.join(tmpDir, 'registry.json');
    fs.writeFileSync(p, JSON.stringify({ alias: 'x', scope: 'town' })); // missing wwuid
    const result = validateRegistryFile(p);
    expect(result.valid).toBe(false);
    expect(result.issues).toContainEqual(expect.objectContaining({ field: 'wwuid', severity: 'error' }));
  });
});
