---
from: CD(RSn).Cpt
to: TM
type: spec-update
date: 2026-05-07T00:36Z
subject: telegraph-protocol-simplified-addressing-format-implementation
---

# Telegraph Protocol Update — Simplified Addressing Format

**From:** CD(RSn).Cpt  
**To:** TM  
**Date:** 2026-05-07T00:36Z  
**Re:** Telegraph addressing refinement — implement role-only format

---

## Summary

Protocol update: **Addressing should use role only, no devPair, no model suffix.**

Telegraph protocol docs updated (wildwest-framework/docs/telegraph-protocol.md). **Implementation spec below.**

---

## Updated Addressing Format

**Current (v0.17.0):**
```yaml
to: CD(RSn).Cpt
```

**New (next iteration):**
```yaml
to: CD
```

**Rationale:**
- Role name encodes scope (CD=county, TM=town, etc.)
- DevPair is implementation detail (model may change, but role is stable)
- Removes fragile coupling to current actor assignments
- Simpler addressing, cleaner parsing

---

## Scope Resolution (Role-Based)

Update `resolveRoleToScope()` to use role alone:

```typescript
const SCOPE_ROLES: Record<string, string[]> = {
  'territory': ['RA', 'G'],
  'county': ['S', 'CD', 'M'],
  'town': ['TM', 'HG'],
};

function resolveRoleToScope(role: string): string | null {
  for (const [scope, roles] of Object.entries(SCOPE_ROLES)) {
    if (roles.includes(role)) {
      return scope;
    }
  }
  return null;
}
```

---

## Town Pattern Matching (Multi-Town Counties)

For town-scoped roles (TM, HG), support **wildcard pattern matching** to disambiguate which town:

```yaml
to: TM(*vscode)    # Route to town matching *vscode
to: TM(*framework) # Route to town matching *framework
to: TM             # Same town (local, no remote delivery)
```

**Implementation in scope resolution:**

```typescript
function extractTownPattern(toField: string): string | null {
  const match = toField.match(/^([A-Za-z]+)(\(\*([^)]+)\))?$/);
  if (!match) return null;
  // match[3] is the pattern, e.g., "vscode"
  return match[3] ? `*${match[3]}` : null;
}

function resolveTownByPattern(pattern: string, towns: any[]): string | null {
  // pattern = "*vscode"
  const regex = new RegExp(`^${pattern.replace(/\*/g, '.*')}$`);
  const matching = towns.find(t => regex.test(t.name));
  return matching ? matching.path : null;
}
```

**Usage:**
```typescript
const pattern = extractTownPattern(toField);  // "*vscode"
if (pattern) {
  const townPath = resolveTownByPattern(pattern, registry.towns);
  // ... deliver to townPath/.wildwest/telegraph/inbox/
}
```

---

## Updated HeartbeatMonitor.deliverPendingOutbox()

Update delivery logic to:

1. Parse role from `to:` field (e.g., `to: TM(*vscode)` → extract `TM`)
2. Extract optional pattern (e.g., `*vscode`)
3. Look up `role → scope` in `SCOPE_ROLES`
4. If pattern present: resolve town via registry
5. Determine destination path
6. Deliver memo to destination `inbox/`

**Example memo:**
```yaml
---
from: TM
to: CD
---
Status report...
```

Operator processes:
- Role: `CD` → county scope
- Destination: `~/wildwest/counties/wildwest-ai/`
- Delivers to: `~/wildwest/counties/wildwest-ai/.wildwest/telegraph/inbox/`

---

## Example: Town-to-Town Addressing

County has: `wildwest-vscode`, `wildwest-framework`

**Memo from wildwest-vscode TM to wildwest-framework TM:**

```yaml
---
from: TM
to: TM(*framework)
---
Requesting branch review...
```

Operator:
1. Parses `to: TM(*framework)`
2. Extracts role `TM` → town scope
3. Extracts pattern `*framework` → searches registry
4. Matches `wildwest-framework`
5. Resolves path to `~/wildwest/counties/wildwest-ai/wildwest-framework/`
6. Delivers to: `~/wildwest/counties/wildwest-ai/wildwest-framework/.wildwest/telegraph/inbox/`

---

## Migration Path

1. Update `SCOPE_ROLES` to use role-only matching
2. Add `extractTownPattern()` and `resolveTownByPattern()` functions
3. Update `deliverPendingOutbox()` to parse role + optional pattern
4. Update framework scripts (`telegraph-send.sh`, `telegraph-ack.sh`) to prompt for role (without devPair)
5. Test with real memos (town-to-county, county-to-town, town-to-town with patterns)

---

## Implementation Timeline

**v0.17.0 → v0.18.0:**
- Implement simplified role-based addressing
- Add town pattern matching
- Update all framework scripts
- Test cross-town delivery

---

## Questions for TM

1. Can this be implemented as part of next telegraph delivery refinement branch?
2. Should we deprecate old `to: CD(RSn).Cpt` format during transition, or break on merge?
3. Need registry sweep to ensure all towns have `name` field for pattern matching?

---

Await TM guidance.

CD(RSn).Cpt
