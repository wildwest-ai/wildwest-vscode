import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { validateAddress, normalizeFromForTerritory, aliasExistsInTerritory } from '../src/mcp/validation';

describe('validation module', () => {
  test('validateAddress accepts valid forms and rejects invalid', () => {
    expect(validateAddress('TM[wildwest-vscode]').valid).toBe(true);
    expect(validateAddress('TM(who)').valid).toBe(false); // town role + dyad invalid
    expect(validateAddress('CD(RSn)[county-alias]').valid).toBe(true);
    expect(validateAddress('UNKNOWN[alias]').valid).toBe(false);
  });

  test('normalizeFromForTerritory converts brackets to parens', () => {
    expect(normalizeFromForTerritory('TM[wildwest-vscode]')).toBe('TM(wildwest-vscode)');
    expect(normalizeFromForTerritory('RA[county]')).toBe('RA(county)');
    expect(normalizeFromForTerritory('')).toBe('');
  });

  test('aliasExistsInTerritory finds aliases in territory, counties and towns', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ww-test-'));
    try {
      // territory registry
      const terrWildwest = path.join(tmp, '.wildwest');
      fs.mkdirSync(terrWildwest, { recursive: true });
      fs.writeFileSync(path.join(terrWildwest, 'registry.json'), JSON.stringify({ alias: 'territory-alias' }), 'utf8');

      // county
      const county = path.join(tmp, 'counties', 'county-a');
      const countyWild = path.join(county, '.wildwest');
      fs.mkdirSync(countyWild, { recursive: true });
      fs.writeFileSync(path.join(countyWild, 'registry.json'), JSON.stringify({ alias: 'county-alias' }), 'utf8');

      // town under county
      const town = path.join(county, 'town-1');
      const townWild = path.join(town, '.wildwest');
      fs.mkdirSync(townWild, { recursive: true });
      fs.writeFileSync(path.join(townWild, 'registry.json'), JSON.stringify({ alias: 'town-alias' }), 'utf8');

      expect(aliasExistsInTerritory(tmp, 'territory-alias')).toBe(true);
      expect(aliasExistsInTerritory(tmp, 'county-alias')).toBe(true);
      expect(aliasExistsInTerritory(tmp, 'town-alias')).toBe(true);
      expect(aliasExistsInTerritory(tmp, 'missing')).toBe(false);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
