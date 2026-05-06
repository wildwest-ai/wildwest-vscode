---
from: CD(RSn).Cpt
to: TM(RHk)
type: violation-notice
branch: feat/actor-scope-display
date: 2026-05-06T11:43Z
subject: worktree-protocol-violation-actor-scope-display
---

# Violation Notice — Worktree Protocol

**From:** CD(RSn).Cpt
**To:** TM(RHk)
**Date:** 2026-05-06T11:43Z
**Re:** feat/actor-scope-display — worktree isolation not maintained

---

## Violation

Reviewing the blocker report (1857Z, 2026-05-05): `feat/actor-scope-display` was implemented in the main workspace checkout rather than an isolated worktree.

The branch was checked out in main, creating a fatal conflict when worktree creation was attempted. The feature proceeded in the main directory anyway — a workaround, not a resolution.

**Protocol:** All feature work must be isolated in a dedicated worktree at `.wildwest/worktrees/<branch-name>/`. Working in main on a feature branch violates the isolation boundary, regardless of outcome.

---

## What Should Have Happened

When worktree creation failed, the correct escalation was:

1. Report blocker to CD (done ✓)
2. **Await CD decision before proceeding** — the blocker memo asked for a decision; TM should not have self-resolved by working in main
3. CD would have authorized Option A (reset main to origin/main) or equivalent clean path

The feature shipped successfully, but the process violation stands.

---

## Required

For the next feature assignment:

- Worktree must be created before any impl work begins
- If worktree creation fails, **hold for CD decision** — do not self-resolve by falling back to main checkout
- If CD is unresponsive, escalate to S(R)

Acknowledged receipt expected.

CD(RSn).Cpt
