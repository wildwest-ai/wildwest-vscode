# Telegraph Delivery — Implementation Design

> **Last updated:** 2026-05-06T11:54Z
> **Status:** Design — not yet implemented
> **Scope:** `wildwest-vscode` extension
> **Protocol spec:** `wildwest-framework/docs/telegraph-protocol.md`

---

## What We Have Now

Three components already exist in `wildwest-vscode` that form the local telegraph office:

| Component | File | Current role |
|---|---|---|
| `TelegraphWatcher` | `src/TelegraphWatcher.ts` | Watches `.wildwest/telegraph/` root — sees new files |
| `HeartbeatMonitor` | `src/HeartbeatMonitor.ts` | Knows scope topology; fires on interval; runs cleanup (Rule 23) |
| `TelegraphCommands` | `src/TelegraphCommands.ts` | Ack + send commands |

The office exists. It does not yet deliver — it only files.

---

## Delivery: HeartbeatMonitor as Operator

The operator runs as part of each heartbeat tick — no separate polling loop, no new process.

**On each tick, `HeartbeatMonitor` calls `deliverPendingOutbox()`:**

```
1. Scan own-scope outbox/ for undelivered memos
2. Parse YAML frontmatter — read `to:` field
3. Resolve destination scope path via HeartbeatMonitor scope registry
4. Write memo to <destination>/.wildwest/telegraph/inbox/<filename>
5. Stamp delivery: add `delivered_at: <ISO-8601>` to memo frontmatter
6. Archive original: outbox/ → outbox/history/ (sent archive)
```

**Why heartbeat, not TelegraphWatcher:**
- Heartbeat already knows scope topology — no redundant discovery
- Heartbeat fires on interval — eventual delivery matches the telegraph metaphor
- `TelegraphWatcher` stays read-only — clean separation of concerns
- One loop, no new background process

---

## TelegraphWatcher — Inbox Watch

After migration, `TelegraphWatcher` watches `inbox/` instead of the telegraph root.

- Read-only surface — never writes
- Fires notification when new memo arrives in `inbox/`
- Legacy flat mode (`telegraph/` root) supported during migration transition

---

## TelegraphCommands — Outbox Write

`telegraphSend` writes new memos to `outbox/`. `telegraphAck` reads from `inbox/`.

Actors never write directly to `inbox/` — only the operator does.

---

## Visibility: Multi-Scope Telegraph Status Badge

For county/world actors in a multi-root workspace, `TelegraphWatcher` gains aggregation mode.

**Scope detection:**
```
workspace folders
  → filter: has .wildwest/telegraph/ (inbox/ or root)
  → classify each: town / county / world (registry.json scope field)
  → aggregate unread count per scope
```

**Status bar badge:**
```
$(mail) N          ← total unread across all scopes
tooltip:
  wildwest-vscode  2
  wildwest-framework  0
  ─────────────────
  Total            3
```

- Badge appears only when N > 0
- Clicking opens quick-pick listing memo filenames grouped by scope
- "Unread" = files in `inbox/` not in `history/`, not `.last-beat`, not `.gitkeep`

**Mode selection:**

| Workspace type | Mode |
|---|---|
| Single-folder (one `.wildwest/`) | Single-scope count — existing behavior |
| Multi-root with multiple `.wildwest/` | Aggregate all scopes — world-observer mode |

No configuration required. Mode inferred from workspace structure.

**Relation to delivery:**
- Badge reads from `inbox/` — correctly scoped to what the actor is meant to see
- Does not read `outbox/` — operator territory
- Complementary to delivery, not a replacement:

```
HeartbeatMonitor  →  delivers memos (write)
TelegraphWatcher  →  surfaces unread count (read)
StatusBar badge   →  exposes count to human (display)
```

---

## Remote Delivery (Future — wwMCP)

Local filesystem delivery handles same-machine scopes. Cross-machine or remote scopes → wwMCP.

The actor interface does not change: write to `outbox/`, read from `inbox/`. `deliverPendingOutbox()` delegates to wwMCP client instead of direct FS write. Badge data source swaps under the hood.

---

## Implementation Milestones

| Milestone | Component | What |
|---|---|---|
| Next feat branch | `HeartbeatMonitor.ts` | Add `deliverPendingOutbox()` — call on each tick |
| Next feat branch | `TelegraphWatcher.ts` | Watch `inbox/` instead of telegraph root; legacy flat fallback |
| Next feat branch | `TelegraphCommands.ts` | `telegraphSend` writes to `outbox/`; `telegraphAck` reads from `inbox/` |
| Next feat branch | `scripts/` (framework) | Update `telegraph-send.sh` + `telegraph-ack.sh` to outbox/inbox paths |
| Follow-on branch | `TelegraphWatcher.ts` | Multi-scope aggregation mode; status bar badge with per-town breakdown |
| Future | wwMCP | Remote delivery; `deliverPendingOutbox()` delegates to wwMCP client |
