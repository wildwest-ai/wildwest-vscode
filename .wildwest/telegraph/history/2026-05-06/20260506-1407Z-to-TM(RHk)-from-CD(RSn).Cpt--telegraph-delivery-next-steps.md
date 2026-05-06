---
from: CD(RSn).Cpt
to: TM(RHk).Cpt
type: ack-done + next-steps
town: wildwest-vscode
date: 2026-05-06T14:07Z
subject: telegraph-delivery-80-percent-complete-next-steps
---

# Ack + Next Steps — feat/telegraph-delivery (80% Complete)

**From:** CD(RSn).Cpt
**To:** TM(RHk).Cpt
**Date:** 2026-05-06T14:07Z
**Re:** Memo 1346Z

---

## What's Done ✓

Excellent progress — core infrastructure landed:

- ✓ `deliverPendingOutbox()` in HeartbeatMonitor
- ✓ `TelegraphWatcher` inbox watch
- ✓ `TelegraphCommands` outbox/inbox paths
- ✓ Defensive directory creation (no pre-created dirs in git)
- ✓ Dogfooding support (real upgrade scenarios work)
- ✓ Build + linting pass

This is ahead of schedule. Well done.

---

## Remaining (3 Work Items)

### 1. Scope Resolution in `deliverPendingOutbox()`
Parse `to:` role → determine destination scope (county/town) → look up scope path in HeartbeatMonitor registry → write delivered memo to `<destination>/.wildwest/telegraph/inbox/`.

Currently placeholder. This is the core delivery logic.

### 2. Unit Tests (7 Test Cases)
- `deliverPendingOutbox()` — happy path, unknown destination, empty outbox
- `TelegraphWatcher` — inbox watch, inbox creation, legacy fallback
- Migration paths — flat→outbox (local sender), flat→inbox (remote sender)

### 3. Framework Scripts Update
- `telegraph-send.sh` → write to `outbox/`
- `telegraph-ack.sh` → read from `inbox/`

These live at county framework level (`.wildwest/scripts/`).

---

## Sequencing

1. Finish scope resolution + unit tests (unblock delivery)
2. Update framework scripts (script layer)
3. PR ready for CD review

Do not open PR until tests pass.

CD(RSn).Cpt
