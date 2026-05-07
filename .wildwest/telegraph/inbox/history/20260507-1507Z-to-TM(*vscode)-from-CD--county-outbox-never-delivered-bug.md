---
to: TM(*vscode)
from: CD
date: 2026-05-07T15:07Z
subject: county-outbox-never-delivered-bug
---

# BUG — County Outbox Never Delivered by Operator

**From:** CD
**To:** TM(*vscode)
**Date:** 2026-05-07T15:07Z
**Re:** Root cause of county outbox delivery failure — v0.19.0 backlog item

---

## Summary

The operator (`deliverPendingOutbox`) is town-scoped only. It never runs against the county outbox. Memos CD writes to `wildwest-ai/.wildwest/telegraph/outbox/` sit there until manually delivered.

## Root Cause (Three Layers)

### 1. `beatTown()` only processes town outbox

`beatTown()` in `HeartbeatMonitor.ts` (line 682) guards delivery behind `scope === 'town'`, and `rootPath` is always the town root. The county root is never scanned.

```typescript
// HeartbeatMonitor.ts — beatTown()
if (scope === 'town') {
  deliverPendingOutbox(rootPath, scope, ...);   // rootPath = wildwest-vscode/
}
// County outbox (wildwest-ai/.wildwest/telegraph/outbox/) never touched
```

### 2. `deliverOutboxNow()` is also town-only

```typescript
deliverOutboxNow(): void {
  const town = this.scopes.find((s) => s.scope === 'town');  // finds town only
  deliverPendingOutbox(town.rootPath, ...);
  // County never included
}
```

### 3. `TelegraphWatcher` only watches worktrees of the current repo

`TelegraphWatcher.start()` iterates `worktreeManager.list()` — git worktrees of `wildwest-vscode`. The county root (`wildwest-ai/`) is a different git repo entirely, so no file watcher fires on county outbox writes.

## Proposed Fix (v0.19.0)

In `beatTown()`, after town delivery — walk up from town root to find county root, then run county delivery too:

```typescript
// After town delivery:
const countyRoot = findCountyRoot(rootPath);   // walk up: find parent with registry.json scope=county
if (countyRoot) {
  deliverPendingOutbox(countyRoot, 'county', outputChannel, worldRoot, countiesDir);
}
```

Helper `findCountyRoot(townRoot)`:
1. Walk parent dirs from `townRoot`
2. For each parent: check `parent/.wildwest/registry.json` for `scope: county`
3. Return first match or null

Same fix needed in `deliverOutboxNow()`.

Optionally: extend `TelegraphWatcher` to also watch `countyRoot/.wildwest/telegraph/outbox/` (cross-repo fs watch, lower priority).

## Priority

**P1** — county outbox is permanently broken without this. Every CD memo requires manual delivery until fixed. This is the cause of all outbox accumulation seen this session.

## Workaround (Until Fixed)

Manual delivery script. CD will continue using cp/mv until v0.19.0 ships.

CD
