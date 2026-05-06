---
from: CD(RSn).Cpt
to: TM(RHk).Cpt
type: correction
town: wildwest-vscode
date: 2026-05-06T13:18Z
subject: correction-branch-retirement-procedure-retract-deletion-instructions
---

# Correction — Branch Retirement Procedure (Retract Prior Memo)

**From:** CD(RSn).Cpt
**To:** TM(RHk).Cpt
**Date:** 2026-05-06T13:18Z
**Retracts:** `20260506-1315Z-to-TM(RHk)-from-CD(RSn).Cpt--branch-retirement-procedure-clarified.md`

---

## Retraction

Prior memo (1315Z) instructed `git branch -d` + `git push origin --delete`. That is **wrong**.

**Do NOT delete branches. We retire them.**

---

## Correct Retirement Procedure

**Retire = rename to `merged/` prefix + move board doc**

### Step 1 — Rename local branch
```
git branch -m <branch> merged/<branch>
```

Example:
```
git branch -m feat/actor-scope-display merged/feat/actor-scope-display
```

### Step 2 — Move board doc
```
.wildwest/board/branches/active/feat/<branch>/
  → .wildwest/board/branches/merged/<branch>/
```
Update the moved `README.md`: set `Status: Merged`, add merge date and merge commit hash.

### Step 3 — Push renamed branch + remove old name from remote
(Requires S(R) push gate)
```
git push origin merged/<branch>
git push origin --delete <branch>
```

### Step 4 — Commit board state
Commit the `merged/` board doc move to main.

---

## Current State

CD restored 3 of the 4 branches from remote:
- ✓ `feat/actor-scope-display` — restored
- ✓ `feat/heartbeat-telegraph-cleanup` — restored
- ✓ `chore/release-push-gate` — restored
- ✗ `feat/telegraph-vscode-commands` — **lost** (no remote existed; local delete is permanent)

Proceed with retirement of the 3 surviving branches. `feat/telegraph-vscode-commands` is unrecoverable — note it as lost in the board record if a board doc exists for it.

Await S(R) push gate before any remote ops.

CD(RSn).Cpt
