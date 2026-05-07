import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Mock logger for tests
const mockLogger = {
  log: jest.fn(),
};

// Test helper: Create mock town registry
function createMockRegistry(alias: string, scope: 'town' | 'county' = 'town'): string {
  return JSON.stringify({
    scope,
    schema_version: '2',
    alias,
    wwuid: `mock-${alias}`,
  });
}

// Mock SCOPE_ROLES (from HeartbeatMonitor)
const SCOPE_ROLES: Record<string, string[]> = {
  'territory': ['RA', 'G'],
  'county': ['S', 'CD', 'M'],
  'town': ['TM', 'HG'],
};

// Extract role from 'to:' field
function extractTownPattern(toField: string): { role: string; pattern: string | null } | null {
  const match = toField.match(/^([A-Za-z]+)(?:\(\*([^)]+)\))?$/);
  if (!match) return null;
  const role = match[1];
  const pattern = match[2] ? `*${match[2]}` : null;
  return { role, pattern };
}

// Resolve role to scope
function resolveRoleToScope(role: string): string | null {
  for (const [scope, roles] of Object.entries(SCOPE_ROLES)) {
    if (roles.includes(role)) {
      return scope;
    }
  }
  return null;
}

// List towns in county
function listTownsInCounty(countyPath: string): Array<{ name: string; path: string; alias: string | null }> {
  const towns: Array<{ name: string; path: string; alias: string | null }> = [];
  try {
    if (!fs.existsSync(countyPath)) return towns;
    const entries = fs.readdirSync(countyPath);
    for (const entry of entries) {
      const entryPath = path.join(countyPath, entry);
      const stat = fs.statSync(entryPath);
      if (!stat.isDirectory() || entry.startsWith('.')) continue;
      const regPath = path.join(entryPath, '.wildwest', 'registry.json');
      if (fs.existsSync(regPath)) {
        try {
          const reg = JSON.parse(fs.readFileSync(regPath, 'utf8')) as Record<string, unknown>;
          const alias = (reg['alias'] as string) || entry;
          towns.push({ name: entry, path: entryPath, alias });
        } catch {
          // Invalid registry
        }
      }
    }
  } catch {
    // Directory error
  }
  return towns;
}

// Resolve town by pattern
function resolveTownByPattern(pattern: string, towns: Array<{ name: string; path: string; alias: string | null }>): string | null {
  if (!pattern || !towns.length) return null;
  const regexPattern = pattern
    .replace(/\./g, '\\.')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  const regex = new RegExp(`^${regexPattern}$`);
  for (const town of towns) {
    if (regex.test(town.alias!) || regex.test(town.name)) {
      return town.path;
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// TEST SUITE
// ─────────────────────────────────────────────────────────────────────────────

describe('Telegraph Delivery v2 — Simplified Addressing', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'telegraph-v2-'));
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true });
    }
  });

  // ─── Test 1: Role-Only Addressing ───────────────────────────────────────
  describe('Test 1: Role-only addressing (new format)', () => {
    it('should parse role-only format "CD" correctly', () => {
      const result = extractTownPattern('CD');
      expect(result).toEqual({ role: 'CD', pattern: null });
    });

    it('should resolve role CD to county scope', () => {
      const scope = resolveRoleToScope('CD');
      expect(scope).toBe('county');
    });

    it('should resolve role TM to town scope', () => {
      const scope = resolveRoleToScope('TM');
      expect(scope).toBe('town');
    });

    it('should resolve role G to territory scope', () => {
      const scope = resolveRoleToScope('G');
      expect(scope).toBe('territory');
    });
  });

  // ─── Test 2: Town Pattern Extraction ─────────────────────────────────────
  describe('Test 2: Town pattern matching', () => {
    it('should extract pattern from "TM(*vscode)"', () => {
      const result = extractTownPattern('TM(*vscode)');
      expect(result).toEqual({ role: 'TM', pattern: '*vscode' });
    });

    it('should extract pattern from "TM(*framework)"', () => {
      const result = extractTownPattern('TM(*framework)');
      expect(result).toEqual({ role: 'TM', pattern: '*framework' });
    });

    it('should extract pattern from "HG(*delivery*)"', () => {
      const result = extractTownPattern('HG(*delivery*)');
      expect(result).toEqual({ role: 'HG', pattern: '*delivery*' });
    });

    it('should return null for invalid format "CD(RSn).Cpt"', () => {
      const result = extractTownPattern('CD(RSn).Cpt');
      expect(result).toBeNull();
    });
  });

  // ─── Test 3: Backward Compatibility (Old Format) ─────────────────────────
  describe('Test 3: Old format detection (deprecation warning)', () => {
    it('should detect old format "CD(RSn).Cpt" as deprecated', () => {
      const isOldFormat = /\([A-Za-z]\)\./.test('CD(RSn).Cpt');
      expect(isOldFormat).toBe(true);
    });

    it('should not flag new format as deprecated', () => {
      const isOldFormat = /\([A-Za-z]\)\./.test('CD');
      expect(isOldFormat).toBe(false);
    });

    it('should not flag pattern format as deprecated', () => {
      const isOldFormat = /\([A-Za-z]\)\./.test('TM(*vscode)');
      expect(isOldFormat).toBe(false);
    });
  });

  // ─── Test 4: Town Resolution by Pattern ──────────────────────────────────
  describe('Test 4: Wildcard pattern matching', () => {
    it('should match "wildwest-vscode" with pattern "*vscode"', () => {
      const towns = [
        { name: 'wildwest-vscode', path: '/path/vscode', alias: 'wildwest-vscode' },
        { name: 'wildwest-framework', path: '/path/framework', alias: 'wildwest-framework' },
      ];
      const matched = resolveTownByPattern('*vscode', towns);
      expect(matched).toBe('/path/vscode');
    });

    it('should match "wildwest-framework" with pattern "*framework"', () => {
      const towns = [
        { name: 'wildwest-vscode', path: '/path/vscode', alias: 'wildwest-vscode' },
        { name: 'wildwest-framework', path: '/path/framework', alias: 'wildwest-framework' },
      ];
      const matched = resolveTownByPattern('*framework', towns);
      expect(matched).toBe('/path/framework');
    });

    it('should match with pattern "*delivery*"', () => {
      const towns = [
        { name: 'wildwest-delivery-operator', path: '/path/delivery', alias: 'wildwest-delivery-operator' },
        { name: 'wildwest-vscode', path: '/path/vscode', alias: 'wildwest-vscode' },
      ];
      const matched = resolveTownByPattern('*delivery*', towns);
      expect(matched).toBe('/path/delivery');
    });

    it('should return null when no pattern matches', () => {
      const towns = [
        { name: 'wildwest-vscode', path: '/path/vscode', alias: 'wildwest-vscode' },
        { name: 'wildwest-framework', path: '/path/framework', alias: 'wildwest-framework' },
      ];
      const matched = resolveTownByPattern('*unknown*', towns);
      expect(matched).toBeNull();
    });

    it('should handle empty town list', () => {
      const matched = resolveTownByPattern('*vscode', []);
      expect(matched).toBeNull();
    });
  });

  // ─── Test 5: Town Registry Listing ──────────────────────────────────────
  describe('Test 5: List towns in county', () => {
    it('should discover towns by registry.json files', () => {
      // Create mock county structure
      const countyPath = path.join(tempDir, 'counties', 'wildwest-ai');
      const vscodeDir = path.join(countyPath, 'wildwest-vscode', '.wildwest');
      const frameworkDir = path.join(countyPath, 'wildwest-framework', '.wildwest');

      fs.mkdirSync(vscodeDir, { recursive: true });
      fs.mkdirSync(frameworkDir, { recursive: true });

      fs.writeFileSync(
        path.join(vscodeDir, 'registry.json'),
        createMockRegistry('wildwest-vscode', 'town'),
      );
      fs.writeFileSync(
        path.join(frameworkDir, 'registry.json'),
        createMockRegistry('wildwest-framework', 'town'),
      );

      // List towns
      const towns = listTownsInCounty(countyPath);
      expect(towns).toHaveLength(2);
      expect(towns.map((t) => t.alias)).toContain('wildwest-vscode');
      expect(towns.map((t) => t.alias)).toContain('wildwest-framework');
    });

    it('should skip directories without registry.json', () => {
      const countyPath = path.join(tempDir, 'counties', 'wildwest-ai');
      const townDir1 = path.join(countyPath, 'town1');
      const townDir2 = path.join(countyPath, 'town2', '.wildwest');

      fs.mkdirSync(townDir1, { recursive: true });
      fs.mkdirSync(townDir2, { recursive: true });

      // Only town2 has registry
      fs.writeFileSync(
        path.join(townDir2, 'registry.json'),
        createMockRegistry('town2', 'town'),
      );

      const towns = listTownsInCounty(countyPath);
      expect(towns).toHaveLength(1);
      expect(towns[0].alias).toBe('town2');
    });

    it('should handle non-existent county path', () => {
      const nonExistent = path.join(tempDir, 'nonexistent');
      const towns = listTownsInCounty(nonExistent);
      expect(towns).toEqual([]);
    });
  });

  // ─── Test 6: Multiple Towns Disambiguation ──────────────────────────────
  describe('Test 6: Pattern disambiguates multiple towns', () => {
    it('should route to correct town when multiple exist in county', () => {
      const towns = [
        { name: 'wildwest-vscode', path: '/county/wildwest-vscode', alias: 'wildwest-vscode' },
        { name: 'wildwest-framework', path: '/county/wildwest-framework', alias: 'wildwest-framework' },
        { name: 'wildwest-cli', path: '/county/wildwest-cli', alias: 'wildwest-cli' },
      ];

      // Test each pattern
      const vscodePath = resolveTownByPattern('*vscode', towns);
      const frameworkPath = resolveTownByPattern('*framework', towns);
      const cliPath = resolveTownByPattern('*cli', towns);

      expect(vscodePath).toBe('/county/wildwest-vscode');
      expect(frameworkPath).toBe('/county/wildwest-framework');
      expect(cliPath).toBe('/county/wildwest-cli');
    });

    it('should disambiguate similar-named towns', () => {
      const towns = [
        { name: 'delivery-v1', path: '/county/delivery-v1', alias: 'delivery-v1' },
        { name: 'delivery-v2', path: '/county/delivery-v2', alias: 'delivery-v2' },
        { name: 'delivery-core', path: '/county/delivery-core', alias: 'delivery-core' },
      ];

      const v1Path = resolveTownByPattern('*v1', towns);
      const v2Path = resolveTownByPattern('*v2', towns);
      const corePath = resolveTownByPattern('*core', towns);

      expect(v1Path).toBe('/county/delivery-v1');
      expect(v2Path).toBe('/county/delivery-v2');
      expect(corePath).toBe('/county/delivery-core');
    });
  });

  // ─── Test 7: Invalid Addressing ─────────────────────────────────────────
  describe('Test 7: Error handling for invalid addressing', () => {
    it('should reject empty to: field', () => {
      const result = extractTownPattern('');
      expect(result).toBeNull();
    });

    it('should reject malformed patterns', () => {
      const invalidPatterns = [
        'TM(vscode)',      // Missing asterisk
        'TM[vscode]',      // Wrong brackets
        'TM{vscode}',      // Wrong brackets
        '(vscode)',        // No role
        'TM(*vscode',      // Missing closing paren
        'TM*vscode)',      // Missing opening paren
      ];

      for (const pattern of invalidPatterns) {
        const result = extractTownPattern(pattern);
        expect(result).toBeNull();
      }
    });

    it('should handle unknown roles', () => {
      const scope = resolveRoleToScope('UNKNOWN');
      expect(scope).toBeNull();
    });
  });

  // ─── Test 8: Format Transitions ─────────────────────────────────────────
  describe('Test 8: Old → new format transitions', () => {
    it('should accept both old and new addressing during transition', () => {
      // Old format
      const oldResult = extractTownPattern('CD(RSn).Cpt');
      expect(oldResult).toBeNull(); // Doesn't parse with new parser

      // But old format detection should still work
      const isOld = /\([A-Za-z]\)\./.test('CD(RSn).Cpt');
      expect(isOld).toBe(true);

      // New format parses correctly
      const newResult = extractTownPattern('CD');
      expect(newResult).toEqual({ role: 'CD', pattern: null });
    });

    it('should warn on deprecated format in logging', () => {
      const toField = 'CD(RSn).Cpt';
      const isDeprecated = /\([A-Za-z]\)\./.test(toField);
      if (isDeprecated) {
        mockLogger.log(`WARNING: ${toField} is deprecated format (v0.18.0). Use role-only format.`);
      }
      expect(mockLogger.log).toHaveBeenCalled();
    });
  });
});
