# feat/telegraph-delivery — Branch Doc

> **Last updated:** 2026-05-06T13:14Z
> **Status:** Planned
> **Created:** 2026-05-06 — CD(RSn).Cpt
> **Type:** feature
> **Owner:** TM(RHk)
> **Base branch:** main

---

## Purpose

**Problem:** The telegraph model is a shared desk — all memos across all actors sit in one flat directory. Actors reach into each other's scope to read and write, creating invisible boundary violations and structural pressure toward scope-crossing git ops.

**Solution:** Implement the outbox/inbox delivery model per `wildwest-framework/docs/telegraph-protocol.md`. Split `.wildwest/telegraph/` into `outbox/` (actor writes) and `inbox/` (operator delivers). `HeartbeatMonitor` acts as the local operator — delivers memos on each tick via `deliverPendingOutbox()`. No actor enters another scope's filesystem path.

Full spec: [spec.md](spec.md)

---

## Scope

### In Scope
- Create `outbox/` and `inbox/` subdirs in `.wildwest/telegraph/` for all governed repos
- `HeartbeatMonitor.ts` — add `deliverPendingOutbox()` method; call on each heartbeat tick
- `TelegraphWatcher.ts` — watch `inbox/` instead of telegraph root; legacy flat fallback during migration
- `TelegraphCommands.ts` — `telegraphSend` writes to `outbox/`; `telegraphAck` reads from `inbox/`
- Update `telegraph-send.sh` + `telegraph-ack.sh` (framework scripts) for outbox/inbox paths
- Migration: move active flat memos to appropriate `outbox/` on first run

### Out of Scope
- Multi-scope badge (follow-on branch)
- wwMCP remote delivery (future)
- TODO #10 autonomous actor processing (separate branch — depends on this)
- UI changes beyond `TelegraphWatcher` watch path

---

## Done Criteria

- [ ] `.wildwest/telegraph/outbox/` and `inbox/` exist in all governed repos
- [ ] `deliverPendingOutbox()` runs on each heartbeat tick
- [ ] Memo written to `outbox/` appears in destination `inbox/` on next tick
- [ ] `delivered_at` stamped in memo frontmatter after delivery
- [ ] Original moved to `outbox/history/` after delivery
- [ ] `TelegraphWatcher` watches `inbox/` — fires on new memo arrival
- [ ] `telegraphSend` writes to `outbox/`
- [ ] `telegraphAck` reads from `inbox/`
- [ ] Flat legacy memos in telegraph root still readable during transition
- [ ] No actor reads from another scope's `outbox/` or writes to another scope's `inbox/`
- [ ] Framework scripts (`telegraph-send.sh`, `telegraph-ack.sh`) updated
- [ ] All existing unit tests pass
- [ ] New unit tests for `deliverPendingOutbox()` — delivery, stamping, archive

---

## Dependencies

- `wildwest-framework/docs/telegraph-protocol.md` — spec (exists ✓)
- `wildwest-vscode/docs/telegraph-delivery.md` — implementation design (exists ✓)
