# Telegraph Addressing Protocol v0.18.0+

> **Last updated:** 2026-05-07T00:45Z  
> **Status:** Implemented in v0.18.0
> **Scope:** `wildwest-vscode` extension + `wildwest-framework` scripts
> **Replaces:** Old format `CD(RSn).Cpt` (deprecated in v0.18.0, removed in v0.19.0)

---

## Overview

Telegraph protocol v0.18.0 simplifies memo addressing by removing actor-specific coupling. Memos now address **roles** (e.g., `CD`, `TM`) rather than actor-role-channel tuples (e.g., `CD(RSn).Cpt`).

This enables:
- **Simpler format**: "CD" instead of "CD(RSn).Cpt"
- **Town-to-town routing**: Wildcard patterns like `TM(*vscode)` route across multiple towns
- **Actor independence**: Role changes don't break memo routing
- **Backward compatibility**: v0.18.0 accepts both old and new formats (v0.19.0 breaks old format)

---

## Address Format

### New Format (v0.18.0+)

**Role-only addressing:**
```
to: CD
from: TM
```

**Town-to-town with pattern:**
```
to: TM(*vscode)
from: CD
```

### Old Format (v0.17.0)

```
to: CD(RSn).Cpt
from: TM(RHk).Cpt
```

This format is now deprecated. **Migration plan:**
- **v0.18.0**: Accepts both formats; logs deprecation warning for old format
- **v0.19.0**: Rejects old format; only new format valid

---

## Addressing Rules

### Role Resolution

Each role maps to a scope tier:

| Role | Scope | Examples |
|---|---|---|
| `RA`, `G` | territory | World-level operators |
| `S`, `CD`, `M` | county | County-level decision makers |
| `TM`, `HG` | town | Town-level operators |

**Resolution:** Sender looks up role in [`SCOPE_ROLES`](../src/HeartbeatMonitor.ts) to determine destination scope.

### Town Pattern Matching (v0.18.0+)

When addressing a town role (`TM` or `HG`) from a county or another town, use **glob-style patterns**:

```
TM(*vscode)          # Match town alias ending in 'vscode'
TM(*framework)       # Match town alias ending in 'framework'
TM(*delivery*)       # Match town alias containing 'delivery'
TM(?)                # Match town alias with exactly one character
TM(*ai*)             # Match town alias containing 'ai'
```

**Pattern matching:**
- `*` matches zero or more characters
- `?` matches exactly one character
- Case-sensitive matching against `registry.json` `alias` field
- If multiple towns match, **first match** is selected (no ambiguity error)

**Discovery:** Destination towns listed dynamically by scanning `<county>/.wildwest/registry.json` files.

### Local Delivery (Same Scope)

No pattern needed:
```
to: TM              # Within same town, routes to town
to: CD              # Within same county, routes to county
to: G               # Within same territory, routes to territory
```

### Multi-Scope Delivery

```
to: CD              # From town → county parent (automatic)
to: G               # From county → territory parent (automatic)
to: TM(*vscode)     # From county → town wildwest-vscode (pattern required)
```

---

## Examples

### Town-to-County Memo

**File**: `YYYYMMDD-HHMMZ-to-CD-from-TM--heartbeat-status.md`

```yaml
---
to: CD
from: TM
date: 2026-05-07T00:45Z
subject: heartbeat-status
---

# Heartbeat Status

Town is operational.
```

**Delivery**: Routed from `wildwest-vscode/.wildwest/telegraph/outbox/` → `wildwest-ai/.wildwest/telegraph/inbox/`

### County-to-Town Memo

**File**: `YYYYMMDD-HHMMZ-to-TM(*vscode)-from-CD--directive.md`

```yaml
---
to: TM(*vscode)
from: CD
date: 2026-05-07T00:45Z
subject: directive
---

# Directive

Execute registry scan.
```

**Delivery**: Routed from `wildwest-ai/.wildwest/telegraph/outbox/` → `wildwest-vscode/.wildwest/telegraph/inbox/`

### Multi-Town Pattern

**File**: `YYYYMMDD-HHMMZ-to-TM(*delivery*)-from-CD--scan-results.md`

```yaml
---
to: TM(*delivery*)
from: CD
date: 2026-05-07T00:45Z
subject: scan-results
---

# Scan Results

All delivery towns operational.
```

**Delivery**: If county has multiple towns with "delivery" in alias (e.g., `wildwest-delivery-operator`, `delivery-v2`), memo routed to first match.

---

## Implementation: Parsing & Resolution

### 1. Extract Pattern

```typescript
function extractTownPattern(toField: string): { role: string; pattern: string | null } | null {
  const match = toField.match(/^([A-Za-z]+)(?:\(\*([^)]+)\))?$/);
  if (!match) return null;
  return { role: match[1], pattern: match[2] ? `*${match[2]}` : null };
}
```

Examples:
- `"CD"` → `{ role: "CD", pattern: null }`
- `"TM(*vscode)"` → `{ role: "TM", pattern: "*vscode" }`
- `"CD(RSn).Cpt"` → `null` (old format, doesn't parse)

### 2. Resolve Role to Scope

```typescript
function resolveRoleToScope(role: string): string | null {
  // Lookup in SCOPE_ROLES
  for (const [scope, roles] of Object.entries(SCOPE_ROLES)) {
    if (roles.includes(role)) return scope;
  }
  return null;
}
```

### 3. List Towns in County

```typescript
function listTownsInCounty(countyPath: string): Array<{ name; path; alias }> {
  // Scan directories for .wildwest/registry.json
  // Extract alias from each registry
  // Return array of { name, path, alias }
}
```

### 4. Match Pattern to Town

```typescript
function resolveTownByPattern(pattern: string, towns: Array<...>): string | null {
  const regexPattern = pattern
    .replace(/\./g, '\\.')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  const regex = new RegExp(`^${regexPattern}$`);
  return towns.find(t => regex.test(t.alias) || regex.test(t.name))?.path || null;
}
```

### 5. Deliver Memo

On heartbeat, `deliverPendingOutbox()`:
1. Scan outbox/ for undelivered memos
2. Parse `to:` field
3. Detect old format (log deprecation warning)
4. Extract role + pattern
5. Resolve destination scope + town (if pattern)
6. Write memo to destination inbox/
7. Archive original to outbox/history/ with `delivered_at:` timestamp

---

## Backward Compatibility

### v0.18.0 Behavior

Old format (`CD(RSn).Cpt`) is detected and handled:
- **Extract**: Role prefix `CD` is extracted
- **Deliver**: Uses role-only routing (ignores actor/channel suffix)
- **Warn**: Logs deprecation message
- **Archive**: Original memo (with old format) archived after delivery

**User experience:** Memos still deliver, but user sees warning to migrate.

### v0.19.0 Behavior

Old format no longer supported. Memos with `(...).*` pattern in `to:` field will **fail to deliver** with an error in logs.

### Migration Path

1. **v0.18.0 release**: Users see warnings for old-format memos
2. **Deprecation period**: 1-2 weeks (encourage update of scripts)
3. **v0.19.0 release**: Old format rejected; users must use new format

**Manual migration:**
- `CD(RSn).Cpt` → `CD`
- `TM(RHk).Cpt` → `TM`
- `TM(RHk).Cpt` (target specific town) → `TM(*town-alias)`

---

## Framework Scripts

### telegraph-send.sh (v0.18.0+)

Updated to prompt for role and optional pattern:

```bash
$ bash telegraph-send.sh
To (role, e.g., 'CD' or 'TM'): TM
To (optional pattern, e.g., '*vscode' for TM-to-town routing): 
From (role, e.g., 'TM' or 'CD'): CD
Subject (kebab-case slug): heartbeat-status
```

Generates memo with `to: TM` and `from: CD`.

With pattern:

```bash
To (role, e.g., 'CD' or 'TM'): TM
To (optional pattern, e.g., '*vscode' for TM-to-town routing): *vscode
From (role, e.g., 'TM' or 'CD'): CD
Subject (kebab-case slug): directive
```

Generates memo with `to: TM(*vscode)` and `from: CD`.

### telegraph-ack.sh

No changes needed. Parses existing memos (both old and new formats) from inbox/ and creates acknowledgments with new format.

---

## Validation & Testing

Unit tests cover:
- ✅ Role-only addressing (CD → county, TM → town, G → territory)
- ✅ Town pattern extraction ("TM(*vscode)" parsing)
- ✅ Old format detection ("CD(RSn).Cpt" deprecation warning)
- ✅ Wildcard pattern matching (*vscode, *framework, *delivery*)
- ✅ Town registry listing (discover towns via .wildwest/registry.json)
- ✅ Multi-town disambiguation (pattern routes to correct town)
- ✅ Invalid addressing (error handling for malformed formats)
- ✅ Format transition (old → new migration path)

See: [__tests__/telegraphDeliveryV2.test.ts](../__tests__/telegraphDeliveryV2.test.ts)

---

## Related

- [Telegraph Delivery](./telegraph-delivery.md) — Operator mechanics
- [Registry Schema](./REGISTRY_SCHEMA.md) — Registry fields
- [Protocol Spec](../../../wildwest-framework/docs/telegraph-protocol.md) — Base protocol
- [HeartbeatMonitor](../src/HeartbeatMonitor.ts) — Implementation source
