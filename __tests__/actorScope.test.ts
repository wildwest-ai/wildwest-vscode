// Test for identity scope validation logic
// Note: HeartbeatMonitor requires vscode context, so we test the validation
// logic independently of the full extension environment

describe('Identity Scope Validation Logic', () => {
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

  // Identity validation helper (mirrors HeartbeatMonitor.validateIdentityForScope)
  function validateIdentityForScope(identity: string, scope: string): boolean {
    if (!identity) return true; // Empty identity is valid
    const roleMatch = identity.match(/^([A-Za-z]+)/);
    if (!roleMatch) return false; // Malformed identity
    const role = roleMatch[1];
    return isValidRoleForScope(role, scope);
  }

  describe('validateIdentityForScope()', () => {
    it('should accept empty identity (no declaration)', () => {
      expect(validateIdentityForScope('', 'town')).toBe(true);
    });

    it('should accept valid town role: Mayor', () => {
      expect(validateIdentityForScope('Mayor(ABC)', 'town')).toBe(true);
    });

    it('should accept valid town role: TM', () => {
      expect(validateIdentityForScope('TM(RHk)', 'town')).toBe(true);
    });

    it('should accept valid town role: HG', () => {
      expect(validateIdentityForScope('HG(XYZ)', 'town')).toBe(true);
    });

    it('should reject invalid town role: RA', () => {
      expect(validateIdentityForScope('RA(RSn)', 'town')).toBe(false);
    });

    it('should reject invalid town role: CD', () => {
      expect(validateIdentityForScope('CD(RSn)', 'town')).toBe(false);
    });

    it('should accept valid county role: S', () => {
      expect(validateIdentityForScope('S(Admin)', 'county')).toBe(true);
    });

    it('should accept valid county role: CD', () => {
      expect(validateIdentityForScope('CD(RSn)', 'county')).toBe(true);
    });

    it('should accept valid county role: TM', () => {
      expect(validateIdentityForScope('TM(RHk)', 'county')).toBe(true);
    });

    it('should reject invalid county role: Mayor', () => {
      expect(validateIdentityForScope('Mayor(ABC)', 'county')).toBe(false);
    });

    it('should reject invalid county role: RA', () => {
      expect(validateIdentityForScope('RA(RSn)', 'county')).toBe(false);
    });

    it('should accept valid territory role: G', () => {
      expect(validateIdentityForScope('G(Global)', 'territory')).toBe(true);
    });

    it('should accept valid territory role: RA', () => {
      expect(validateIdentityForScope('RA(RSn)', 'territory')).toBe(true);
    });

    it('should reject invalid territory role: TM', () => {
      expect(validateIdentityForScope('TM(RHk)', 'territory')).toBe(false);
    });

    it('should reject invalid territory role: CD', () => {
      expect(validateIdentityForScope('CD(RSn)', 'territory')).toBe(false);
    });

    it('should reject role with numbers', () => {
      expect(validateIdentityForScope('123(ABC)', 'town')).toBe(false);
    });

    it('should extract role correctly with complex identity identifier', () => {
      // TM is valid for town; .main is part of identity identifier but doesn't affect validation
      expect(validateIdentityForScope('TM(RHk).main', 'town')).toBe(true);
    });

    it('should return false for unknown scope', () => {
      // Unknown scope should reject all roles (no entries in SCOPE_ROLES)
      expect(validateIdentityForScope('TM(RHk)', 'unknown')).toBe(false);
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

