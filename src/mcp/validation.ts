import * as fs from 'fs';
import * as path from 'path';
import type { MCPScopeContext } from './types';

/**
 * Pure format validation for Wild West addresses.
 * County/town roles MUST have scope brackets: Role[scope] or Role(dyad)[scope]
 * Returns { valid, error }.
 */
export function validateAddress(address: string): { valid: boolean; error?: string } {
  const countyRoles = ['CD', 'S', 'RA', 'aCD', 'DS'];
  const townRoles = ['TM', 'DM', 'HG'];
  const territoryRoles = ['G', 'RA'];

  if (!address || typeof address !== 'string') return { valid: false, error: 'empty address' };

  // Role[(dyad)][scope] or Role[scope]
  const match = address.match(/^([A-Za-z]+)(?:\(([^)]+)\))?(?:\[([^\]]+)\])?$/);
  if (!match) return { valid: false, error: `Invalid address format: '${address}'` };

  const [, role, dyad, scope] = match;

  if (countyRoles.includes(role)) {
    if (!scope) return { valid: false, error: `County role '${role}' requires scope bracket [scope]` };
    return { valid: true };
  }
  if (townRoles.includes(role)) {
    if (dyad) return { valid: false, error: `Town role '${role}' must not include dyad parens` };
    if (!scope) return { valid: false, error: `Town role '${role}' requires scope bracket [scope]` };
    return { valid: true };
  }
  if (territoryRoles.includes(role)) {
    return { valid: true };
  }
  return { valid: false, error: `Unknown role: '${role}'` };
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
 * Search the territory for a registry alias. Returns true if found.
 * This is IO-bound and may be slow; callers should run it asynchronously if needed.
 */
export function aliasExistsInTerritory(worldRoot: string, alias: string): boolean {
  if (!alias) return false;
  try {
    const terrPath = path.join(worldRoot, '.wildwest', 'registry.json');
    if (fs.existsSync(terrPath)) {
      try {
        const terr = JSON.parse(fs.readFileSync(terrPath, 'utf8')) as Record<string, unknown>;
        if (terr['alias'] === alias) return true;
      } catch (err) {
        console.debug(`aliasExistsInTerritory: territory registry read error: ${String(err)}`);
      }
    }

    const candidateCountyDirs: string[] = [];
    try { candidateCountyDirs.push(...fs.readdirSync(worldRoot)); } catch (err) { console.debug(`aliasExistsInTerritory: worldRoot read error: ${String(err)}`); }
    const countiesSub = path.join(worldRoot, 'counties');
    if (fs.existsSync(countiesSub)) {
      try { candidateCountyDirs.push(...fs.readdirSync(countiesSub).map((d) => path.join('counties', d))); } catch (err) { console.debug(`aliasExistsInTerritory: counties subdir read error: ${String(err)}`); }
    }

    for (const c of candidateCountyDirs) {
      const countyPath = path.join(worldRoot, c);
      const countyRegPath = path.join(countyPath, '.wildwest', 'registry.json');
      if (fs.existsSync(countyRegPath)) {
        try {
          const countyReg = JSON.parse(fs.readFileSync(countyRegPath, 'utf8')) as Record<string, unknown>;
          if (countyReg['alias'] === alias) return true;
        } catch (err) {
          console.debug(`aliasExistsInTerritory: county reg read error: ${String(err)}`);
        }
      }

      // towns inside county
      try {
        const towns = fs.readdirSync(countyPath).filter((d) => fs.existsSync(path.join(countyPath, d, '.wildwest')));
        for (const t of towns) {
          const townRegPath = path.join(countyPath, t, '.wildwest', 'registry.json');
          if (!fs.existsSync(townRegPath)) continue;
          try {
            const townReg = JSON.parse(fs.readFileSync(townRegPath, 'utf8')) as Record<string, unknown>;
            if (townReg['alias'] === alias) return true;
          } catch (err) {
            console.debug(`aliasExistsInTerritory: town reg read error: ${String(err)}`);
          }
        }
      } catch (err) {
        console.debug(`aliasExistsInTerritory: towns scan error: ${String(err)}`);
      }
    }
  } catch (err) {
    console.debug(`aliasExistsInTerritory: error: ${String(err)}`);
  }
  return false;
}

export default {
  validateAddress,
  normalizeFromForTerritory,
  defaultRoleForScope,
  senderAddress,
  aliasExistsInTerritory,
};
