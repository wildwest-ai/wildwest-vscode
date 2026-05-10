# feat/memo-ux — Branch Doc

> **Last updated:** 2026-05-09T23:50Z
> **Status:** Active
> **Created:** 2026-05-09 — TM(RHk).Cld
> **Type:** feature
> **Owner:** TM(RHk)
> **Base branch:** main

---

## Purpose

**Problem:** Telegraph memo operations (read, compose, ack, inject) have no coherent UI. Inbox is raw filenames. Compose is serial input boxes. No way to push memo content into AI chat inputs.

**Solution:** A single wildwest webview panel — minimal email-client layout. Inbox list + rendered memo view + compose drawer. Push buttons inject formatted memo into Copilot, Claude Code, or Codex chat inputs.

---

## Layout

```
┌─────────────────────────────────────────────┐
│  📬 Telegraph                    [Compose ✎] │
├──────────────┬──────────────────────────────┤
│ Inbox (3)    │  from: TM(RHk):wildwest-vsc  │
│ ▶ memo-a     │  to:   CD(RSn)               │
│   memo-b     │  date: 2026-05-09T23:16Z     │
│   memo-c     │  subj: hg-protocol-ruling    │
│              │  status: sent                │
│ Outbox (2)   │  ─────────────────────────── │
│   memo-d     │  [body rendered as markdown] │
│   memo-e     │                              │
│              │  [→ Copilot] [→ Claude] [→ Codex] │
└──────────────┴──────────────────────────────┘
│ Compose drawer (slides up on [Compose ✎])   │
│  To: ___  Type: [▼]  Subject: ___           │
│  Body: ________________________________     │
│                              [Send]         │
└─────────────────────────────────────────────┘
```

---

## Push Format

All three targets receive:

```
📬 [from {from} | {subject} | {date}]

{body}
```

- **Copilot**: `workbench.action.chat.open({ query })`
- **Claude Code / Codex**: `workbench.action.terminal.sendSequence` — quick-pick terminal if multiple

---

## Scope

### In Scope
- `TelegraphPanel.ts` — webview panel, full lifecycle
- `TelegraphPanel.html` — panel HTML/CSS/JS (inline in provider)
- `wildwest.openTelegraphPanel` command
- Inbox + outbox list from `MemoStorageService` + filesystem fallback
- Rendered memo view (markdown body + header table)
- Compose drawer → calls `MemoStorageService` + outbox write
- Push buttons: Copilot (`chat.open`), Claude/Codex (`sendSequence` + terminal picker)
- Sidebar "Open Telegraph Panel" shortcut

### Out of Scope
- History/archive view (deferred)
- Thread linking (deferred)
- Search/filter (deferred)

---

## Done Criteria

- [ ] `wildwest.openTelegraphPanel` opens panel
- [ ] Inbox and outbox memos listed; click renders memo
- [ ] Memo renders: header table + markdown body
- [ ] Compose drawer: To / Type / Subject / Body → writes JSON to outbox + storage
- [ ] [→ Copilot] opens Copilot chat with formatted memo
- [ ] [→ Claude] / [→ Codex] sends to terminal via quick-pick
- [ ] Sidebar panel has "Open Telegraph" button

---

## Living Sections

### Status

Active. Implementation in progress.

### Actor Assignment

**TM(RHk).Cld — reneyap + Sonnet (acting TM)**
Full implementation.
