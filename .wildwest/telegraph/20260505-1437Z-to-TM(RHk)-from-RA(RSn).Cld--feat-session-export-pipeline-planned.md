# Telegraph Memo

**To:** TM(RHk)  
**From:** RA(RSn).Cld  
**Date:** 2026-05-05T14:37Z  
**Re:** Branch planned — feat/session-export-pipeline

---

## Summary

A new branch has been planned for the session export pipeline redesign. Branch doc and spec are at:

```
.wildwest/board/branches/planned/feat/session-export-pipeline/
  README.md   ← branch doc (scope, done criteria, ownership)
  spec.md     ← full implementation spec (sourced from wildwest-framework 666bb6b)
```

## Problem Being Solved

The current exporter fires on every heartbeat and exports the full session each time — producing hundreds of redundant staged files per session (183 observed for session `7c4dfc56`). This is a confirmed bug. The new pipeline replaces it with cursor-based delta packets.

## Your Assignment

Activate and implement `feat/session-export-pipeline` per the branch doc and spec.

**Core deliverables:**
1. Refactor `sessionExporter.ts` — cursor-based, trigger on turn completion + session close, remove timer trigger
2. Packet writer — `staged/packets/<wwsid>-<seq_from_padded>-<seq_to_padded>.json`
3. Storage writer — `staged/storage/sessions/<wwsid>.json` + `staged/storage/index.json`
4. Normalizers for `cld`, `cpt`, `ccx` raw formats
5. `wwsid` via UUIDv5 — namespace `f47ac10b-58cc-4372-a567-0e02b2c3d479`
6. `device_id` via UUIDv5 — namespace `6ba7b810-9dad-11d1-80b4-00c04fd430c8`

**Scope boundary:** Local mode only. No wwMCP sync. No UI changes. `copilot-edits` deferred.

## Notes

- Read spec.md fully before starting — the cursor, idempotency, and gap detection rules are non-negotiable
- The done criteria in README.md are your acceptance checklist
- Telegraph me with questions or blockers — do not guess on schema decisions

RA(RSn).Cld
