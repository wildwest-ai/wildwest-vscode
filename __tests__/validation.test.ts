import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import validation from '../src/mcp/validation';

describe('validation.validateAddress', () => {
  test('valid town role', () => {
    const r = validation.validateAddress('TM[wildwest-vscode]');
    expect(r.valid).toBe(true);
  });

  test('valid county role with dyad', () => {
    const r = validation.validateAddress('CD(RSn)[wildwest-ai]');
    expect(r.valid).toBe(true);
  });

  test('invalid format', () => {
    const r = validation.validateAddress('not a valid address');
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/Invalid address format/);
  });

  test('unknown role', () => {
    const r = validation.validateAddress('FOO[bar]');
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/Unknown role/);
  });
});

describe('validation.aliasExistsInTerritory', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ww-test-'));
  });
  afterEach(() => {
    try { fs.rmSync(tmp, { recursive: true }); } catch { /* ignore */ }
  });

  test('finds alias in territory root registry', () => {
    const regdir = path.join(tmp, '.wildwest');
    fs.mkdirSync(regdir, { recursive: true });
    fs.writeFileSync(path.join(regdir, 'registry.json'), JSON.stringify({ alias: 'terra' }));
    expect(validation.aliasExistsInTerritory(tmp, 'terra')).toBe(true);
    expect(validation.aliasExistsInTerritory(tmp, 'nope')).toBe(false);
  });

  test('finds alias in counties subdir', () => {
    const counties = path.join(tmp, 'counties', 'countyA');
    const countyRegDir = path.join(counties, '.wildwest');
    fs.mkdirSync(countyRegDir, { recursive: true });
    fs.writeFileSync(path.join(countyRegDir, 'registry.json'), JSON.stringify({ alias: 'countyA' }));
    expect(validation.aliasExistsInTerritory(tmp, 'countyA')).toBe(true);
  });
});
