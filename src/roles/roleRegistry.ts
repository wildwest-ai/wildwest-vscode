/**
 * Canonical Role/Scope Registry
 *
 * Single source of truth for role tokens, scope tiers, routing behavior, and
 * pattern requirements. Derived from the county-level spec:
 *   ~/wildwest/counties/wildwest-ai/docs/role-scope-registry.md
 *   Approved by S(R), authored by CD(RSn).
 *
 * All routing logic and validation tables must derive from this module.
 */

export type WildWestScope = 'territory' | 'county' | 'town';

export interface RoleDefinition {
  /** Canonical token used in addressing, e.g. "TM", "CD", "aCD". */
  token: string;
  displayName: string;
  scope: WildWestScope;
  routable: boolean;
  /**
   * When true, a town-pattern qualifier is required in the `to:` field
   * (e.g. `TM(*vscode)`). Applies to town-scoped roles in multi-town counties.
   */
  patternRequired: boolean;
  /**
   * When true, this role may only be held by a human actor.
   */
  humanOnly: boolean;
  /**
   * When set, delivery for this role is directed to the aliased role's inbox.
   * No separate inbox exists for the aliased role.
   *   aCD → CD (county inbox)
   *   DM  → TM (town inbox)
   */
  routingAlias?: string;
}

/**
 * The canonical role table. Order matches the role-scope-registry.md spec.
 * Do not edit without S(R) approval.
 */
export const ROLES: readonly RoleDefinition[] = [
  { token: 'G',   displayName: 'Governor',           scope: 'territory', routable: true, patternRequired: false, humanOnly: true  },
  { token: 'RA',  displayName: 'Ranger',              scope: 'territory', routable: true, patternRequired: false, humanOnly: false },
  { token: 'S',   displayName: 'Sheriff',             scope: 'county',    routable: true, patternRequired: false, humanOnly: true  },
  { token: 'CD',  displayName: 'Chief Deputy',        scope: 'county',    routable: true, patternRequired: false, humanOnly: false },
  { token: 'aCD', displayName: 'acting Chief Deputy', scope: 'county',    routable: true, patternRequired: false, humanOnly: false, routingAlias: 'CD' },
  { token: 'DS',  displayName: 'Deputy Sheriff',      scope: 'county',    routable: true, patternRequired: false, humanOnly: false },
  { token: 'M',   displayName: 'Mayor',               scope: 'town',      routable: true, patternRequired: true,  humanOnly: true  },
  { token: 'TM',  displayName: 'Town Marshal',        scope: 'town',      routable: true, patternRequired: true,  humanOnly: false },
  { token: 'DM',  displayName: 'Deputy Marshal',      scope: 'town',      routable: true, patternRequired: true,  humanOnly: false, routingAlias: 'TM' },
  { token: 'HG',  displayName: 'Hired Gun',           scope: 'town',      routable: true, patternRequired: true,  humanOnly: false },
];

/** All role tokens for a given scope tier. */
export function scopeRoles(scope: WildWestScope): string[] {
  return ROLES.filter((r) => r.scope === scope).map((r) => r.token);
}

/**
 * Resolve a role token to its scope tier.
 * Returns null if the token is not in the registry.
 */
export function resolveRoleToScope(role: string): WildWestScope | null {
  return ROLES.find((r) => r.token === role)?.scope ?? null;
}

/**
 * Role tokens keyed by scope, suitable for use as a Record.
 * Includes all roles — base roles and routing aliases.
 */
export function scopeRoleMap(): Record<WildWestScope, string[]> {
  return {
    territory: scopeRoles('territory'),
    county: scopeRoles('county'),
    town: scopeRoles('town'),
  };
}

/** Look up a role definition by token. Returns undefined if unknown. */
export function getRole(token: string): RoleDefinition | undefined {
  return ROLES.find((r) => r.token === token);
}
