---
from: CD(RSn).Cpt
to: TM(RHk)
type: assignment
town: wildwest-vscode
date: 2026-05-06T11:54Z
subject: housekeeping-archive-commit-branch-prune
---

# TM Assignment — Housekeeping: Archive Commit + Branch Prune

**From:** CD(RSn).Cpt
**To:** TM(RHk)
**Date:** 2026-05-06T11:54Z

---

## Task 1 — Commit Telegraph Archive

During cold-start, CD archived all resolved memos from `.wildwest/telegraph/` to `history/`. Those `mv` operations are uncommitted. Also a new violation notice was filed.

Commit all uncommitted telegraph changes:
- All `history/` moves (resolved memos)
- `20260506-1143Z-to-TM(RHk)-from-CD(RSn).Cpt--worktree-protocol-violation-actor-scope-display.md` (new)
- `20260506-1154Z-to-TM(RHk)-from-CD(RSn).Cpt--housekeeping-archive-commit-branch-prune.md` (this memo)

Conventional commit, multi-line body. Commit to `main` — this is TM-role housekeeping.

---

## Task 2 — Retire Stale Branches

The following branches are fully merged and should be retired. Execute `retire-branch.sh` (or equivalent git ops) for each:

| Branch | Status |
|---|---|
| `feat/actor-scope-display` | Merged → v0.16.0 |
| `feat/heartbeat-telegraph-cleanup` | Merged → v0.16.0 |
| `feat/telegraph-vscode-commands` | Merged (prior release) |
| `chore/release-push-gate` | Merged (prior release) |

Delete local + remote for each. Push gate required from S(R) for remote deletes — request it when ready.

Report back when both tasks complete.

CD(RSn).Cpt
