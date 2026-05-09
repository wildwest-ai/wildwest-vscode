# Telegraph Delivery — Feature Spec

**Version:** 1.0.0-draft
**Created:** 2026-05-06T13:14Z
**Author:** CD(RSn).Cpt
**Status:** Draft — pending TM implementation
**Protocol:** `wildwest-framework/docs/telegraph-protocol.md`
**Impl design:** `wildwest-vscode/docs/telegraph-delivery.md`

---

## Problem

The current telegraph is a shared flat directory:

```
.wildwest/telegraph/
  to-TM(RHk)--assignment.md
  to-CD(RSn)--status.md
  history/
```

All actors read and write to the same location. CD must enter a town repo to read TM's reports. That boundary violation is structural — the read-to-commit path is short and the scope boundary is invisible. This caused the 2026-05-03 incident (CD committed in TM's repo).

---

## Solution

Split into `outbox/` and `inbox/`. `HeartbeatMonitor` acts as the delivery operator on each tick.

```
.wildwest/telegraph/
  outbox/       ← actor writes here
  inbox/        ← operator writes here; actor reads
  history/      ← archived acked memos
```

---

## Directory Structure Changes

Apply to all governed repos (`wildwest-vscode`, `wildwest-framework`, `wildwest-ai` county):

```
.wildwest/telegraph/
  outbox/
    history/    ← sent archive (post-delivery originals)
  inbox/
  history/      ← acked memos (existing)
```

---

## HeartbeatMonitor — `deliverPendingOutbox()`

Called on every heartbeat tick after existing ops (cleanup, sentinel write).

```typescript
async deliverPendingOutbox(): Promise<void>
```

**Algorithm:**

```
1. List files in own-scope outbox/ (exclude outbox/history/)
2. For each memo file:
   a. Parse YAML frontmatter — extract `to:` field
   b. Resolve destination scope path:
      - Parse role from `to:` (CD/S/M(R)/RA → county; TM/HG → town)
      - Look up scope path via HeartbeatMonitor scope registry
      - If scope path unknown or unreachable → log warning, skip
   c. Write memo to <destination>/.wildwest/telegraph/inbox/<filename>
   d. Stamp `delivered_at: <ISO-8601>` in memo YAML frontmatter
   e. Move original: outbox/<filename> → outbox/history/<filename>
3. Log delivery count
```

**Scope resolution table:**

| Role prefix | Scope | Path source |
|---|---|---|
| `CD`, `S`, `M(R)`, `RA` | County | county sentinel path |
| `TM`, `HG`, `DM` | Town (same town unless named) | town sentinel path |

---

## TelegraphWatcher — Inbox Watch

Change watch target from `.wildwest/telegraph/` root to `.wildwest/telegraph/inbox/`.

**Legacy fallback:** During migration, also watch root for flat memos (files not in `outbox/` or `inbox/`). Log a warning when flat memos are detected — prompts migration.

```typescript
// Primary watch
watchPath = path.join(telegraphRoot, 'inbox')

// Legacy fallback (migration period only)
watchPathLegacy = telegraphRoot  // filter out outbox/, inbox/, history/
```

---

## TelegraphCommands — Outbox Write

`telegraphSend` writes new memos to `outbox/`:

```typescript
const memoPath = path.join(telegraphRoot, 'outbox', filename)
```

`telegraphAck` reads from `inbox/`, moves to `history/` after ack:

```typescript
const inboxPath = path.join(telegraphRoot, 'inbox', filename)
const historyPath = path.join(telegraphRoot, 'history', filename)
```

---

## Framework Scripts

Update `telegraph-send.sh` and `telegraph-ack.sh`:

| Script | Change |
|---|---|
| `telegraph-send.sh` | Write memo to `.wildwest/telegraph/outbox/` |
| `telegraph-ack.sh` | Read from `.wildwest/telegraph/inbox/`; move to `history/` |

---

## Migration

On first run with delivery active:

1. Scan `.wildwest/telegraph/` root for flat memos (not in `outbox/`, `inbox/`, `history/`)
2. For each flat memo: determine sender (parse `from:` frontmatter)
   - If sender is local actor → move to `outbox/` (will be delivered on next tick)
   - If sender is remote actor → move to `inbox/` (already "delivered", just mis-filed)
3. Log migration actions

No manual migration required from actors.

---

## Unit Tests

New tests required:

| Test | Coverage |
|---|---|
| `deliverPendingOutbox()` — happy path | memo delivered to correct inbox, `delivered_at` stamped, original archived |
| `deliverPendingOutbox()` — unknown destination | warning logged, memo left in outbox |
| `deliverPendingOutbox()` — empty outbox | no-op, no errors |
| `TelegraphWatcher` — inbox watch | fires on new file in `inbox/` |
| `TelegraphWatcher` — legacy flat fallback | fires on flat memo, logs warning |
| Migration — local sender flat memo | moved to `outbox/` |
| Migration — remote sender flat memo | moved to `inbox/` |
