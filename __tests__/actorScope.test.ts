// Test for actor scope validation logic
// Note: HeartbeatMonitor requires vscode context, so we test the validation
// logic independently of the full extension environment

describe('Actor Scope Validation Logic', () => {
  // Scope → valid roles mapping (same as HeartbeatMonitor.SCOPE_ROLES)
  const SCOPE_ROLES: Record<string, string[]> = {
    'territory': ['G', 'RA'],
    'county': ['S', 'CD', 'TM'],
    'town': ['Mayor', 'TM', 'HG'],
  };

  // Validation helper (mirrors HeartbeatMonitor.isValidRoleForScope)
  function isValidRoleForScope(role: string, scope: string): boolean {
    const validRoles = SCOPE_ROLES[scope] || [];
    return validRoles.includes(role);
  }

  // Actor validation helper (mirrors HeartbeatMonitor.validateActorForScope)
  function validateActorForScope(actor: string, scope: string): boolean {
    if (!actor) return true; // Empty actor is valid
    const roleMatch = actor.match(/^([A-Za-z]+)/);
    if (!roleMatch) return false; // Malformed actor
    const role = roleMatch[1];
    return isValidRoleForScope(role, scope);
  }

  describe('validateActorForScope()', () => {
    it('should accept empty actor (no declaration)', () => {
      expect(validateActorForScope('', 'town')).toBe(true);
    });

    it('should accept valid town role: Mayor', () => {
      expect(validateActorForScope('Mayor(ABC)', 'town')).toBe(true);
    });

    it('should accept valid town role: TM', () => {
      expect(validateActorForScope('TM(RHk)', 'town')).toBe(true);
    });

    it('should accept valid town role: HG', () => {
      expect(validateActorForScope('HG(XYZ)', 'town')).toBe(true);
    });

    it('should reject invalid town role: RA', () => {
      expect(validateActorForScope('RA(RSn)', 'town')).toBe(false);
    });

    it('should reject invalid town role: CD', () => {
      expect(validateActorForScope('CD(RSn)', 'town')).toBe(false);
    });

    it('should accept valid county role: S', () => {
      expect(validateActorForScope('S(Admin)', 'county')).toBe(true);
    });

    it('should accept valid county role: CD', () => {
      expect(validateActorForScope('CD(RSn)', 'county')).toBe(true);
    });

    it('should accept valid county role: TM', () => {
      expect(validateActorForScope('TM(RHk)', 'county')).toBe(true);
    });

    it('should reject invalid county role: Mayor', () => {
      expect(validateActorForScope('Mayor(ABC)', 'county')).toBe(false);
    });

    it('should reject invalid county role: RA', () => {
      expect(validateActorForScope('RA(RSn)', 'county')).toBe(false);
    });

    it('should accept valid territory role: G', () => {
      expect(validateActorForScope('G(Global)', 'territory')).toBe(true);
    });

    it('should accept valid territory role: RA', () => {
      expect(validateActorForScope('RA(RSn)', 'territory')).toBe(true);
    });

    it('should reject invalid territory role: TM', () => {
      expect(validateActorForScope('TM(RHk)', 'territory')).toBe(false);
    });

    it('should reject invalid territory role: CD', () => {
      expect(validateActorForScope('CD(RSn)', 'territory')).toBe(false);
    });

    it('should reject role with numbers', () => {
      expect(validateActorForScope('123(ABC)', 'town')).toBe(false);
    });

    it('should extract role correctly with complex actor identifier', () => {
      // TM is valid for town; .main is part of actor identifier but doesn't affect validation
      expect(validateActorForScope('TM(RHk).main', 'town')).toBe(true);
    });

    it('should return false for unknown scope', () => {
      // Unknown scope should reject all roles (no entries in SCOPE_ROLES)
      expect(validateActorForScope('TM(RHk)', 'unknown')).toBe(false);
    });
  });

  describe('isValidRoleForScope()', () => {
    it('should return true for town scope with Mayor role', () => {
      expect(isValidRoleForScope('Mayor', 'town')).toBe(true);
    });

    it('should return false for town scope with RA role', () => {
      expect(isValidRoleForScope('RA', 'town')).toBe(false);
    });

    it('should return true for county scope with CD role', () => {
      expect(isValidRoleForScope('CD', 'county')).toBe(true);
    });

    it('should return true for territory scope with G role', () => {
      expect(isValidRoleForScope('G', 'territory')).toBe(true);
    });

    it('should handle all valid town roles', () => {
      expect(isValidRoleForScope('Mayor', 'town')).toBe(true);
      expect(isValidRoleForScope('TM', 'town')).toBe(true);
      expect(isValidRoleForScope('HG', 'town')).toBe(true);
    });

    it('should handle all valid county roles', () => {
      expect(isValidRoleForScope('S', 'county')).toBe(true);
      expect(isValidRoleForScope('CD', 'county')).toBe(true);
      expect(isValidRoleForScope('TM', 'county')).toBe(true);
    });

    it('should handle all valid territory roles', () => {
      expect(isValidRoleForScope('G', 'territory')).toBe(true);
      expect(isValidRoleForScope('RA', 'territory')).toBe(true);
    });
  });
});

