import {
  ROLES,
  scopeRoles,
  resolveRoleToScope,
  scopeRoleMap,
  getRole,
} from '../src/roles/roleRegistry';

describe('roleRegistry', () => {
  describe('ROLES table', () => {
    it('contains exactly 10 role definitions', () => {
      expect(ROLES).toHaveLength(10);
    });

    it('has correct tokens', () => {
      const tokens = ROLES.map((r) => r.token);
      expect(tokens).toEqual(['G', 'RA', 'S', 'CD', 'aCD', 'DS', 'M', 'TM', 'DM', 'HG']);
    });

    it('M token has displayName Mayor (Phase 0 rename)', () => {
      const m = ROLES.find((r) => r.token === 'M')!;
      expect(m.displayName).toBe('Mayor');
    });

    it('aCD has routingAlias CD', () => {
      expect(getRole('aCD')?.routingAlias).toBe('CD');
    });

    it('DM has routingAlias TM', () => {
      expect(getRole('DM')?.routingAlias).toBe('TM');
    });

    it('no other roles have routingAlias', () => {
      const aliased = ROLES.filter((r) => r.routingAlias && r.token !== 'aCD' && r.token !== 'DM');
      expect(aliased).toHaveLength(0);
    });
  });

  describe('scopeRoles()', () => {
    it('territory roles are G and RA', () => {
      expect(scopeRoles('territory')).toEqual(['G', 'RA']);
    });

    it('county roles are S, CD, aCD, DS (no TM)', () => {
      expect(scopeRoles('county')).toEqual(['S', 'CD', 'aCD', 'DS']);
    });

    it('town roles are M, TM, DM, HG (no Mayor)', () => {
      expect(scopeRoles('town')).toEqual(['M', 'TM', 'DM', 'HG']);
    });

    it('TM is not in county roles', () => {
      expect(scopeRoles('county')).not.toContain('TM');
    });

    it('M is in town roles (not Mayor)', () => {
      expect(scopeRoles('town')).toContain('M');
      expect(scopeRoles('town')).not.toContain('Mayor');
    });
  });

  describe('resolveRoleToScope()', () => {
    it('G → territory', () => expect(resolveRoleToScope('G')).toBe('territory'));
    it('RA → territory', () => expect(resolveRoleToScope('RA')).toBe('territory'));
    it('S → county', () => expect(resolveRoleToScope('S')).toBe('county'));
    it('CD → county', () => expect(resolveRoleToScope('CD')).toBe('county'));
    it('aCD → county', () => expect(resolveRoleToScope('aCD')).toBe('county'));
    it('DS → county', () => expect(resolveRoleToScope('DS')).toBe('county'));
    it('M → town', () => expect(resolveRoleToScope('M')).toBe('town'));
    it('TM → town', () => expect(resolveRoleToScope('TM')).toBe('town'));
    it('DM → town', () => expect(resolveRoleToScope('DM')).toBe('town'));
    it('HG → town', () => expect(resolveRoleToScope('HG')).toBe('town'));
    it('Mayor → null (removed in Phase 0)', () => expect(resolveRoleToScope('Mayor')).toBeNull());
    it('unknown token → null', () => expect(resolveRoleToScope('ZZ')).toBeNull());
  });

  describe('scopeRoleMap()', () => {
    it('returns a Record with all 3 scopes', () => {
      const map = scopeRoleMap();
      expect(Object.keys(map)).toEqual(expect.arrayContaining(['territory', 'county', 'town']));
    });

    it('county does not include TM', () => {
      expect(scopeRoleMap().county).not.toContain('TM');
    });

    it('town does not include Mayor', () => {
      expect(scopeRoleMap().town).not.toContain('Mayor');
    });

    it('town includes DM and M', () => {
      expect(scopeRoleMap().town).toContain('DM');
      expect(scopeRoleMap().town).toContain('M');
    });

    it('county includes aCD and DS', () => {
      expect(scopeRoleMap().county).toContain('aCD');
      expect(scopeRoleMap().county).toContain('DS');
    });
  });

  describe('getRole()', () => {
    it('returns definition for known token', () => {
      const role = getRole('TM')!;
      expect(role.displayName).toBe('Town Marshal');
      expect(role.scope).toBe('town');
      expect(role.patternRequired).toBe(true);
      expect(role.humanOnly).toBe(false);
    });

    it('returns undefined for unknown token', () => {
      expect(getRole('XYZ')).toBeUndefined();
    });

    it('M is human-only (Mayor role)', () => {
      expect(getRole('M')?.humanOnly).toBe(true);
    });

    it('S is human-only (Sheriff)', () => {
      expect(getRole('S')?.humanOnly).toBe(true);
    });

    it('county roles have patternRequired false', () => {
      const countyRoles = ROLES.filter((r) => r.scope === 'county');
      expect(countyRoles.every((r) => r.patternRequired === false)).toBe(true);
    });

    it('territory roles have patternRequired false', () => {
      const territoryRoles = ROLES.filter((r) => r.scope === 'territory');
      expect(territoryRoles.every((r) => r.patternRequired === false)).toBe(true);
    });

    it('town roles have patternRequired true', () => {
      const townRoles = ROLES.filter((r) => r.scope === 'town');
      expect(townRoles.every((r) => r.patternRequired === true)).toBe(true);
    });
  });
});
