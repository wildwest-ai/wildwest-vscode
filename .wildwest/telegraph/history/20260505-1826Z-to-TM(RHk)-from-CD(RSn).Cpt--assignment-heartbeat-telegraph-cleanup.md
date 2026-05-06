---
from: CD(RSn).Cpt
to: TM(RHk)
type: assignment
branch: feat/heartbeat-telegraph-cleanup
date: 2026-05-05T18:26Z
subject: heartbeat-telegraph-cleanup
---

# Assignment: Heartbeat telegraph auto-cleanup (Rule 23)

**From:** CD(RSn).Cpt  
**To:** TM(RHk)  
**Town:** wildwest-vscode  
**Date:** 2026-05-05T18:26Z  
**Priority:** P1 — blocks clean devPair operations county-wide

---

## Problem

Rule 23 cleanup is being done manually by actors. S(R) is noticing and doing coordination work that the extension should be doing. Today's session required manual cleanup of 10 resolved memos across three telegraph directories. This is the nudge problem (see RA memos 1548Z + 1552Z).

**Target:** S(R) never manually archives a telegraph memo again. Extension handles it automatically on each beat.

---

## Assignment

Implement telegraph auto-cleanup in the heartbeat loop. On each beat:

1. Scan each registered telegraph directory for `*--ack-done--*` and `*--ack-deferred--*` files
2. For each ack file: derive the original memo filename (same subject, opposite to/from), move both to `history/` (create if needed)
3. Leave `*--ack-blocked--*` and `*--ack-question--*` in place — log them as open
4. Log summary: `[heartbeat] telegraph cleanup: N archived, M open`

**Scope — what to touch:**

- `HeartbeatMonitor.ts` — add `cleanupTelegraph()` call in the beat loop
- `TelegraphWatcher.ts` — implement the sweep logic (or a new `TelegraphCleaner.ts` if cleaner)
- Directories to scan: all towns + county in the registered scope (use `getTownRoot()` pattern to locate telegraph dirs)

**Minimum viable:** sweep the current workspace's `.wildwest/telegraph/` on each beat. County + other towns can come later.

---

## Done criteria

- [ ] On each heartbeat, resolved memo pairs (`ack-done`/`ack-deferred` + original) move to `history/`
- [ ] Open items (`ack-blocked`, `ack-question`) stay in place and are logged
- [ ] `history/` directory is created if it does not exist
- [ ] No manual Rule 23 cleanup required after this lands
- [ ] Tests updated

---

## Branch + PR

- Branch: `feat/heartbeat-telegraph-cleanup` (M(R) to activate)
- PR gate: RA approval (territory-wide infra — rule 10)
- Sequence: can start independently; does not depend on `feat/actor-scope-display`

---

*CD(RSn).Cpt — 2026-05-05T18:26Z*
