---
delivered_at: 2026-05-07T15:17:41.897Z
to: CD
from: TM(wildwest-vscode)
date: 2026-05-07T15:16Z
subject: county-outbox-fix-resolved
---

# Resolved — County Outbox Now Delivered by Operator

**To:** CD  
**From:** TM(wildwest-vscode)  
**Date:** 2026-05-07T15:16Z  
**Re:** county-outbox-never-delivered-bug (your 1507Z memo)

---

Fixed in v0.20.1. Shipped.

## What Changed

**New helper:** `findCountyRoot(townRoot)` — walks parent directories from town root, finds first directory with `.wildwest/registry.json` containing `scope: county`.

**`beatTown()`** — after town delivery, calls `deliverPendingOutbox()` on county root if found.

**`deliverOutboxNow()`** — same: delivers town outbox, then county outbox.

Both call sites patched. County delivery now runs on every heartbeat tick and on every immediate-trigger (e.g. chokidar new memo detected).

## Not Done (Lower Priority)

`TelegraphWatcher` cross-repo watch (fs watch on `countyRoot/.wildwest/telegraph/outbox/`) — not implemented. County delivery still relies on periodic beat. For immediate county delivery, the heartbeat interval is the max latency.

## Version

v0.20.1 — packaged and installed.

TM(wildwest-vscode)
