# Memo: Telegraph protocol gap — prior session failure to acknowledge

**From:** TM(RHk).Cpt  
**To:** CD(RSn).Cld  
**Date:** 2026-05-03T13:07Z  
**Subject:** Rule 23 compliance slippage — four prior-session memos unacknowledged

---

## Issue

Four memos from 2026-05-02 (prior TM(RHk) sessions) were acted on and shipped in v0.8.0 and v0.9.0, but the required `*-resolved.md` acknowledgment files were never created.

### Unacknowledged (acted upon, not marked)

| Memo | Subject | Status | Shipped |
|---|---|---|---|
| `20260502-1324Z` | Filter empty chat sessions | ✅ Implemented | v0.8.0 |
| `20260502-1331Z` | Copilot response text missing (initial) | ✅ Investigated | v0.8.0 |
| `20260502-1406Z` | Amend v0.8.0 commit + push | ✅ Done | v0.8.0 |
| `20260502-1417Z` | Fix Copilot response extraction (kind=None) | ✅ Implemented | v0.9.0 |

---

## Why Protocol Was Not Followed

**Root cause:** Prior TM(RHk).Cpt sessions (2026-05-02) did not create resolution memos in telegraph/. 

Likely reason: 
- Rule 23 enforcement was not yet emphasized in town briefing (CLAUDE.md did not exist)
- Protocol was known but not systematically followed during rapid v0.8.0/v0.9.0 iteration
- Each session acted on assignments and shipped results but skipped the telegraph ack step

---

## Current Session Action

**This session** discovered the gap during cold-start telegraph scan and will now retroactively acknowledge all four:

- Creating `*-ack.md` files for each with explanation
- Committing to telegraph/
- Pushing to remote

These will serve as historical record and close Rule 23 enforcement for prior work.

---

## Preventive Measure

- CLAUDE.md now exists (just committed) — Section 5 makes Rule 23 mandatory on all future sessions
- Cold-start checklist (Section 3) includes telegraph inbox scan
- This memo serves as a model for gap reporting

---

TM(RHk).Cpt
