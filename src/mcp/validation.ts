import * as fs from 'fs';
import * as path from 'path';
import { MCPScopeContext } from './types';

/**
 * Validate addressing format per wildwest spec (pure format validation).
 * Returns { valid: boolean, error?: string }
 */
export function validateAddress(address: string): { valid: boolean; error?: string } {
  const countyRoles = ['CD', 'S', 'RA', 'aCD', 'DS'];
  const townRoles = ['TM', 'DM', 'HG'];
  const territoryRoles = ['G', 'RA'];

  // Parse: Role[(dyad)][scope]  — allow missing [scope] or missing (dyad)
  const match = address.match(/^([A-Za-z]+)(?:\(([^)]+)\))?(?:\[([^\]]+)\])?$/);
  if (!match) {
    return { valid: false, error: `Invalid address format: '${address}'. Expected Role[(dyad)][scope] or Role[scope] or Role(dyad)` };
  }

  const [, role, dyad] = match;

  if (countyRoles.includes(role)) {
    return { valid: true };
  } else if (townRoles.includes(role)) {
    if (dyad) {
      return { valid: false, error: `Town role '${role}' does not use dyad parens` };
    }
    return { valid: true };
  } else if (territoryRoles.includes(role)) {
    return { valid: true };
  } else {
    return { valid: false, error: `Unknown role: '${role}'` };
  }
}

export function normalizeFromForTerritory(from: string): string {
  if (!from) return from;
  return from.replace(/\[([^\]]+)\]/u, '($1)');
}

export function defaultRoleForScope(scope: MCPScopeContext['scope']): string {
  if (scope === 'county') return 'CD';
  if (scope === 'territory') return 'RA';
  return 'TM';
}

export function senderAddress(ctx: MCPScopeContext, alias: string): string {
  const role = ctx.identity?.match(/^([A-Za-z]+)/)?.[1] ?? defaultRoleForScope(ctx.scope);
  return `${role}[${alias}]`;
}

/**
 * Check whether an alias exists in the territory by searching registry.json files.
 * This is an IO operation and therefore not strictly 'pure'; callers (MCP) should use it.
 */
export function aliasExistsInTerritory(worldRoot: string, alias: string): boolean {
  if (!alias) return false;
  try {
    const terrReg = JSON.parse(fs.readFileSync(path.join(worldRoot, '.wildwest', 'registry.json'), 'utf8')) as Record<string, unknown>;
    if (terrReg['alias'] === alias) return true;
  } catch (err) { console.debug(`aliasExistsInTerritory: territory registry read error: ${String(err)}`); }

  // scan counties and towns. Support both layouts: counties as direct children of worldRoot,
  // or a single 'counties' subdirectory containing county folders.
  try {
    const candidateCountyDirs: string[] = [];
    // direct children
    try { candidateCountyDirs.push(...fs.readdirSync(worldRoot)); } catch (err) { console.debug(`aliasExistsInTerritory: worldRoot read error: ${String(err)}`); }
    // also include worldRoot/counties if present
    const countiesSub = path.join(worldRoot, 'counties');
    if (fs.existsSync(countiesSub)) {
      try { candidateCountyDirs.push(...fs.readdirSync(countiesSub).map((d) => path.join('counties', d))); } catch (err) { console.debug(`aliasExistsInTerritory: counties subdir read error: ${String(err)}`); }
    }

    for (const c of candidateCountyDirs) {
      const countyPath = path.join(worldRoot, c);
      try {
        const countyReg = JSON.parse(fs.readFileSync(path.join(countyPath, '.wildwest', 'registry.json'), 'utf8')) as Record<string, unknown>;
        if (countyReg['alias'] === alias) return true;
      } catch (err) { console.debug(`aliasExistsInTerritory: county reg read error: ${String(err)}`); }

      // towns inside this county path
      try {
        const towns = fs.readdirSync(countyPath).filter((d) => fs.existsSync(path.join(countyPath, d, '.wildwest')));
        for (const t of towns) {
          try {
            const townReg = JSON.parse(fs.readFileSync(path.join(countyPath, t, '.wildwest', 'registry.json'), 'utf8')) as Record<string, unknown>;
            if (townReg['alias'] === alias) return true;
          } catch (err) { console.debug(`aliasExistsInTerritory: town reg read error: ${String(err)}`); }
        }
      } catch (err) { console.debug(`aliasExistsInTerritory: towns scan error: ${String(err)}`); }
    }
  } catch (err) { console.debug(`aliasExistsInTerritory: world root scan error: ${String(err)}`); }

  return false;
}

export default {
  validateAddress,
  normalizeFromForTerritory,
  senderAddress,
  defaultRoleForScope,
  aliasExistsInTerritory,
};
