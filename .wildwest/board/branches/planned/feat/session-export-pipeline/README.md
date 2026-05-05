# feat/session-export-pipeline — Branch Doc

> **Last updated:** 2026-05-05T14:37Z
> **Status:** Planned
> **Created:** 2026-05-05 — RA(RSn).Cld
> **Type:** feature
> **Owner:** TM(RHk)
> **Base branch:** main

---

## Purpose

**Problem:** The current session exporter exports the full session on every heartbeat trigger — producing hundreds of redundant staged files per session (183 observed for a single session). No normalized cross-tool schema. No audit trail. No path to cross-device context restoration.

**Solution:** Replace the current staged export with a cursor-based delta packet pipeline. Normalize all tool sessions (cld, cpt, ccx) into a common schema. Build local storage that is MCP-sync ready.

Full spec: [spec.md](spec.md) — sourced from `wildwest-framework/docs/session-export.md` (`666bb6b`).

---

## Scope

### In Scope
- Refactor `sessionExporter.ts` — cursor-based delta export, trigger on turn completion + session close
- Implement packet writer — `staged/packets/<wwsid>-<seq_from>-<seq_to>.json`
- Implement storage writer — `staged/storage/sessions/<wwsid>.json` + `staged/storage/index.json`
- `wwsid` generation via UUIDv5
- `device_id` generation via UUIDv5
- Normalizers for `cld`, `cpt`, `ccx` raw formats → common turn schema
- Idempotency enforcement on `(wwsid, turn_index)`
- Gap detection on packet sequence
- Remove timer-based export trigger

### Out of Scope
- `copilot-edits` tool (deferred — separate spec)
- wwMCP sync (deferred — local mode only for this branch)
- Context injection / cold-start restoration (deferred)
- UI changes

---

## Done Criteria

- [ ] `staged/` no longer produces multiple files per session for the same session ID
- [ ] Each assistant response produces exactly one packet in `staged/packets/`
- [ ] Session close produces a final packet with `"closed": true`
- [ ] `staged/storage/sessions/<wwsid>.json` accumulates full turn history
- [ ] `staged/storage/index.json` reflects current state of all sessions
- [ ] `wwsid` is deterministic — same tool + tool_sid always produces same `wwsid`
- [ ] Applying a packet twice is a no-op (idempotency)
- [ ] Out-of-sequence packets are rejected with a logged error
- [ ] `cld`, `cpt`, `ccx` raw formats all normalize correctly
- [ ] Thinking turns preserved as `kind: thinking` with `thinking_id` when available
- [ ] `content` field on every turn is a plain string (joined text parts)
- [ ] All new files carry `schema_version: "1"`
- [ ] Existing `staged/` files (timer-based snapshots) are not affected — pipeline is additive until old path is removed

---

## Living Sections

### Status

Planned. Awaiting TM activation.

### Actor Assignment

**TM(RHk) — reneyap + Haiku**
Branch owner. Implementation, worktree management, telegraph reporting.

**RA(RSn).Cld — reneyap + Sonnet**
Spec author. Available for clarification via telegraph.
