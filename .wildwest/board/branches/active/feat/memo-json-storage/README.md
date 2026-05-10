# feat/memo-json-storage — Branch Doc

> **Last updated:** 2026-05-09T23:30Z
> **Status:** Active
> **Created:** 2026-05-09 — TM(RHk).Cld
> **Type:** feature
> **Owner:** TM(RHk)
> **Base branch:** main

---

## Purpose

**Problem:** Telegraph memos are `.md` files with YAML frontmatter. They are not machine-queryable, have no stable identity in storage, and cannot be exposed as first-class objects via wwMCP alongside sessions.

**Solution:** Convert all telegraph memos to `.json`. Assign a `wwuid` at send time. Store memos in `staged/storage/memos/<wwuid>.json` — parallel to `staged/storage/sessions/`. wwMCP reads from storage, not the filesystem inbox.

---

## Scope

### In Scope
- Memo JSON schema (`wwuid`, `wwuid_type: "memo"`, `from`, `to`, `type`, `date`, `subject`, `status`, `body`, `filename`, `schema_version`)
- `MemoStorageService` — write/read `staged/storage/memos/<wwuid>.json` + `memos-index.json`
- `TelegraphCommands.ts` — `finalizeMemo` and `ackMemo` write `.json` to outbox + storage
- `TelegraphWatcher.ts` — watch `.json` inbox files (drop `.md` filter)
- `SidePanelProvider.ts` — `listMemoFiles` reads `.json` memos; status-aware display
- `wwMCPTools.ts` — `wildwest_inbox` reads from `staged/storage/memos/`; `wildwest_telegraph_check` updated
- `DeliveryReceipts.ts` — updated for `.json` filenames

### Out of Scope
- Backfill / migration of existing `.md` memos in history (left as-is)
- Thread linking (`thread_wwuid`) — deferred
- Memo search / filter UI beyond basic status — deferred

---

## JSON Memo Schema

```json
{
  "schema_version": "1",
  "wwuid": "<uuidv5>",
  "wwuid_type": "memo",
  "from": "TM(RHk):wildwest-vscode",
  "to": "CD(RSn)",
  "type": "ack | assignment | status-update | scope-change | question | incident-report",
  "date": "2026-05-09T23:16Z",
  "subject": "my-topic-slug",
  "status": "sent | delivered | acked | archived",
  "body": "...",
  "filename": "20260509-2316Z-to-CD(RSn)-from-TM(RHk):wildwest-vscode--my-topic-slug.json"
}
```

---

## Storage Layout

```
staged/
  storage/
    sessions/<wwuid>.json     ← existing
    memos/<wwuid>.json        ← new
    memos-index.json          ← new (parallel to index.json)
```

---

## Done Criteria

- [ ] `finalizeMemo` writes `.json` to outbox + `staged/storage/memos/<wwuid>.json`
- [ ] `ackMemo` writes `.json` ack to outbox + updates status in storage
- [ ] `TelegraphWatcher` fires on `.json` inbox files
- [ ] `SidePanelProvider` inbox/outbox/history lists read `.json` memos
- [ ] `wwMCPTools.wildwest_inbox` returns memos from storage (not fs scan)
- [ ] `memos-index.json` maintained on every send/ack
- [ ] wwuid deterministic: same from+to+date+subject → same wwuid
- [ ] Existing `.md` memos in history/ not affected

---

## Living Sections

### Status

Active. Implementation in progress.

### Actor Assignment

**TM(RHk).Cld — reneyap + Sonnet (acting TM)**
Branch owner. Full implementation.
