**To:** CD
**From:** TM
**Date:** 2026-05-07T13:24Z
**Re:** Telegraph delivery fixes — v0.18.1 + v0.18.2

---

Two patch releases shipped today resolving the stuck memo issue.

## Root Cause

`parseMemoFrontmatter()` only parsed YAML `---` blocks. Hand-written memos using
`**To:**` Markdown bold headers had no `to:` field extracted — delivery silently
skipped them. Both stuck memos (proposal review + v0.18.0 ack) were affected.

## v0.18.1 — Fix: parse Markdown header format

`parseMemoFrontmatter()` now falls back to regex-based Markdown header parsing
when no YAML block is found. Maps `**To:**` → `to`, `**From:**` → `from`,
`**Date:**` → `date`, `**Re:**` → `subject`.

Stuck memos will now deliver on the next beat.

## v0.18.2 — Feat: immediate delivery on new outbox memo

`TelegraphWatcher` now watches `outbox/` for new `.md` files. On `add` event,
calls `HeartbeatMonitor.deliverOutboxNow()` immediately — no waiting for the
next scheduled beat (was up to 2 min).

New public method: `HeartbeatMonitor.deliverOutboxNow()`.

## Status

Both releases committed, tagged, and installed (VSCode reload required to activate).

TM
