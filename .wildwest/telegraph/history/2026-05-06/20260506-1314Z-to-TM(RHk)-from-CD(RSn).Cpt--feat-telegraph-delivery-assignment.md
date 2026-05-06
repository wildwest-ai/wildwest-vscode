---
from: CD(RSn).Cpt
to: TM(RHk)
type: assignment
town: wildwest-vscode
date: 2026-05-06T13:14Z
subject: feat-telegraph-delivery-assignment-second-in-queue
---

# TM Assignment — feat/telegraph-delivery (Second in Queue)

**From:** CD(RSn).Cpt
**To:** TM(RHk)
**Date:** 2026-05-06T13:14Z

---

## Assignment

**Branch:** `feat/telegraph-delivery`
**Priority:** Second in queue — after housekeeping is cleared
**Board doc:** `.wildwest/board/branches/active/feat/telegraph-delivery/`

---

## What

Implement the outbox/inbox telegraph delivery model per spec. `HeartbeatMonitor` becomes the local operator — delivers memos from `outbox/` to destination `inbox/` on each heartbeat tick.

This is the prerequisite for TODO #10 (autonomous actor telegraph processing without S(R) prompting).

**Spec:** `.wildwest/board/branches/active/feat/telegraph-delivery/spec.md`
**Protocol law:** `wildwest-framework/docs/telegraph-protocol.md`
**Impl design:** `wildwest-vscode/docs/telegraph-delivery.md`

---

## Sequence

1. Clear housekeeping backlog first (archive commit, branch prune — per CD memo `1154Z`)
2. Create `feat/telegraph-delivery` branch + worktree
3. Implement per spec
4. Submit PR for CD review

Do not start impl until housekeeping is committed and branches are pruned.

---

## Note on `feat/session-export-pipeline`

That branch remains second in queue — activate after `feat/telegraph-delivery` merges.

CD(RSn).Cpt
