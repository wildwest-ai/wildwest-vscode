jest.mock('vscode', () => ({
  workspace: { workspaceFolders: [], getConfiguration: () => ({ get: () => 7379 }) },
  window: {
    showErrorMessage: jest.fn(),
    showInformationMessage: jest.fn(),
    showQuickPick: jest.fn(),
    withProgress: jest.fn(),
  },
  ProgressLocation: { Notification: 15 },
}), { virtual: true });

import { generateClaudeMd, generateCountyClaudeMd, generateTerritoryClaudeMd } from '../src/TownInit';

const COMMON_SECTIONS = [
  '## 1. Identity',
  '## 2. Active Roles',
  '## 3. Cold-Start Checklist',
  '## 4. Key Paths',
  '## 5. Telegraph Rules',
  '## 6. Open Work',
  '## 7. Quick Commands',
];

describe('generateClaudeMd', () => {
  const vars = {
    alias: 'test-town',
    wwuid: '83b09a8d-6587-46bb-9e98-880d56db39b2',
    remote: 'https://github.com/wildwest-ai/test-town',
  };

  it('includes alias in heading and identity table', () => {
    const md = generateClaudeMd(vars);
    expect(md).toContain('# CLAUDE.md — test-town Town');
    expect(md).toContain('`test-town`');
  });

  it('includes wwuid in identity table', () => {
    const md = generateClaudeMd(vars);
    expect(md).toContain('`83b09a8d-6587-46bb-9e98-880d56db39b2`');
  });

  it('includes remote URL', () => {
    const md = generateClaudeMd(vars);
    expect(md).toContain('https://github.com/wildwest-ai/test-town');
  });

  it('falls back to (not set) when remote is null', () => {
    const md = generateClaudeMd({ ...vars, remote: null });
    expect(md).toContain('(not set)');
    expect(md).not.toContain('undefined');
  });

  it('includes scope: town', () => {
    const md = generateClaudeMd(vars);
    expect(md).toContain('**Scope:** town');
  });

  it('includes required sections', () => {
    const md = generateClaudeMd(vars);
    for (const section of COMMON_SECTIONS) {
      expect(md).toContain(section);
    }
  });

  it('includes generation attribution', () => {
    const md = generateClaudeMd(vars);
    expect(md).toContain('wildwest-vscode initTown');
  });

  it('includes a Last Updated date in ISO format', () => {
    const md = generateClaudeMd(vars);
    expect(md).toMatch(/\*\*Last Updated:\*\* \d{4}-\d{2}-\d{2}/);
  });

  it('returns a non-empty string', () => {
    const md = generateClaudeMd(vars);
    expect(typeof md).toBe('string');
    expect(md.length).toBeGreaterThan(200);
  });
});

describe('generateCountyClaudeMd', () => {
  const vars = {
    alias: 'wildwest-ai',
    wwuid: 'county-abc-123',
    remote: 'https://github.com/wildwest-ai/wildwest-county',
  };

  it('includes County heading', () => {
    const md = generateCountyClaudeMd(vars);
    expect(md).toContain('# CLAUDE.md — wildwest-ai County');
  });

  it('includes scope: county', () => {
    const md = generateCountyClaudeMd(vars);
    expect(md).toContain('**Scope:** county');
  });

  it('includes wwuid and remote', () => {
    const md = generateCountyClaudeMd(vars);
    expect(md).toContain('`county-abc-123`');
    expect(md).toContain('https://github.com/wildwest-ai/wildwest-county');
  });

  it('falls back to (not set) when remote is null', () => {
    const md = generateCountyClaudeMd({ ...vars, remote: null });
    expect(md).toContain('(not set)');
  });

  it('includes required sections', () => {
    const md = generateCountyClaudeMd(vars);
    for (const section of COMMON_SECTIONS) {
      expect(md).toContain(section);
    }
  });

  it('includes generation attribution', () => {
    const md = generateCountyClaudeMd(vars);
    expect(md).toContain('wildwest-vscode initCounty');
  });

  it('includes Last Updated date', () => {
    const md = generateCountyClaudeMd(vars);
    expect(md).toMatch(/\*\*Last Updated:\*\* \d{4}-\d{2}-\d{2}/);
  });
});

describe('generateTerritoryClaudeMd', () => {
  const vars = {
    alias: 'wildwest',
    wwuid: 'territory-xyz-456',
    remote: null,
  };

  it('includes Territory heading', () => {
    const md = generateTerritoryClaudeMd(vars);
    expect(md).toContain('# CLAUDE.md — wildwest Territory');
  });

  it('includes scope: territory', () => {
    const md = generateTerritoryClaudeMd(vars);
    expect(md).toContain('**Scope:** territory');
  });

  it('includes wwuid', () => {
    const md = generateTerritoryClaudeMd(vars);
    expect(md).toContain('`territory-xyz-456`');
  });

  it('falls back to (not set) when remote is null', () => {
    const md = generateTerritoryClaudeMd(vars);
    expect(md).toContain('(not set)');
  });

  it('includes required sections', () => {
    const md = generateTerritoryClaudeMd(vars);
    for (const section of COMMON_SECTIONS) {
      expect(md).toContain(section);
    }
  });

  it('includes generation attribution', () => {
    const md = generateTerritoryClaudeMd(vars);
    expect(md).toContain('wildwest-vscode initTerritory');
  });

  it('has no County Law reference (territory has no parent)', () => {
    const md = generateTerritoryClaudeMd(vars);
    expect(md).not.toContain('Territory Law');
    expect(md).not.toContain('County Law');
  });

  it('includes Last Updated date', () => {
    const md = generateTerritoryClaudeMd(vars);
    expect(md).toMatch(/\*\*Last Updated:\*\* \d{4}-\d{2}-\d{2}/);
  });
});
