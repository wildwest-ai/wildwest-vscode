---
from: CD(RSn).Cpt
to: CD(RSn).Cpt
type: review
town: wildwest-vscode
date: 2026-05-06T14:10Z
subject: pr4-telegraph-delivery-code-review-and-recommendation
---

# Code Review — PR #4: Telegraph Delivery Operator

**From:** CD(RSn).Cpt (self-review via gh CLI)
**Date:** 2026-05-06T14:10Z
**PR:** https://github.com/wildwest-ai/wildwest-vscode/pull/4

---

## Summary

PR #4 implements 80% of the telegraph delivery operator. Core infrastructure is solid. Scope resolution is properly deferred. Ready for conditional approval with clear blockers.

---

## Code Review

### ✓ HeartbeatMonitor.ts — deliverPendingOutbox()

**Implementation:**
- Parses YAML frontmatter cleanly (regex-based extraction)
- Stamps `delivered_at: <ISO-8601>` in correct position
- Archives original to `outbox/history/` with defensive mkdir
- Logs operations appropriately

**Quality:** Good. Code is defensive (handles missing dirs, missing `to:` field).

**Placeholder:** Scope resolution properly deferred with clear log message. Not a blocker if intentional.

---

### ✓ TelegraphWatcher.ts — Inbox Watch

**Changes:**
- Primary watch target: `.wildwest/telegraph/inbox/` (correct)
- Defensive inbox creation on watcher start (`fs.mkdirSync(..., { recursive: true })`)
- Legacy fallback watcher monitors root for flat memos
- Handles both new and migration scenarios

**Quality:** Good. Supports real upgrade path (existing towns with flat telegraph can transition gracefully).

---

### ✓ TelegraphCommands.ts — Outbox Write

**Changes:**
- `sendMemo()` writes to `outbox/`
- `finalizeMemo()` creates `outbox/` defensively
- `ackMemo()` reads from `inbox/`

**Quality:** Good. Defensive directory creation, clean path handling.

---

### ✓ Board Docs + Impl Design Docs

**Files added:**
- `.wildwest/board/branches/active/feat/telegraph-delivery/{README.md, spec.md}`
- `docs/telegraph-delivery.md` (impl design)

**Quality:** Consistent with framework spec. Board doc status marked "Planned" (should be "In Progress" — minor).

---

## Build & Test Status

**Compilation:** ✓ Pass (no TypeScript errors in modified files)
**ESLint:** Pre-existing warnings in `sessionPipeline/*` (unrelated; not modified in this PR)
**Unit tests:** Pending (7 scenarios specified, not yet implemented)

---

## Pending Work (4 Items)

### 1. Scope Resolution — BLOCKER

Currently logged as placeholder:
```
[HeartbeatMonitor] delivery: <memo> → <role> (scope resolution pending)
```

**Status:** Not implemented. Operator cannot route memos without this.

**Effort:** Parse `to:` role → determine scope (county/town) → look up path in HeartbeatMonitor registry → write to `<destination>/.wildwest/telegraph/inbox/`.

**Recommendation:** MUST complete before merge. This is the delivery mechanism.

---

### 2. Unit Tests — BLOCKER

7 test scenarios specified in spec.md but not implemented:
- `deliverPendingOutbox()` — happy path, unknown destination, empty outbox
- `TelegraphWatcher` — inbox watch, inbox creation, legacy fallback
- Migration paths (flat → outbox, flat → inbox)

**Recommendation:** MUST complete before merge. Prevents regressions on delivery core.

---

### 3. Framework Scripts Update — NICE TO HAVE

`telegraph-send.sh` and `telegraph-ack.sh` need outbox/inbox paths.

**Recommendation:** CAN defer to follow-on PR. These are independent of core delivery feature.

---

### 4. Migration Logic — DEFERRED

Move flat memos from telegraph root to appropriate outbox/inbox.

**Recommendation:** CAN defer. Upgrade support is valuable but not blocking core feature. Follow-on task.

---

## Recommendation

**Conditional Approval:**

- ✅ Approve after scope resolution + unit tests are complete
- ❌ Do NOT merge until blockers resolved
- ⏭️ Framework scripts + migration can follow in separate PRs

**Gate:** Require scope resolution logic + passing unit tests before merge.

---

## Request to TM

Complete scope resolution + implement 7 unit tests. Framework scripts and migration logic can be follow-on work.

Reply when ready to proceed or if guidance needed.

CD(RSn).Cpt
