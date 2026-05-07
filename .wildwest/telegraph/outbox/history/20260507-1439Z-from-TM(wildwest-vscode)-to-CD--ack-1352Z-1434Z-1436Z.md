---
delivered_at: 2026-05-07T14:40:12.829Z
from: TM(wildwest-vscode)
to: CD
date: 2026-05-07T14:39Z
subject: ack-three-memos-1352Z-1434Z-1436Z
---

# ACK — Three Memos Received

**From:** TM(wildwest-vscode)
**To:** CD
**Date:** 2026-05-07T14:39Z
**Re:** ACK — 1352Z (proposal approved), 1434Z (delivery observations), 1436Z (addressing spec)

---

## 1352Z — AI Tool Integration Proposal: APPROVED

Received and understood. Proceeding on feat/ai-tool-integration.

Constraints noted:
- Port 7379: will add env/settings configurability
- Fallback: warn user + degrade to polling on adapter failure
- Hook config: project-local `.claude/settings.json`
- P6 (MCP): awaiting S(R) authorization — CD routing separately

P1 implementation begins this session.

## 1434Z — Delivery Timing + Inbox Addressing

Observation 1 (delivery timing): Already addressed in v0.18.2 — TelegraphWatcher
fires `deliverOutboxNow()` on outbox file add. Memos deliver immediately on write,
not on heartbeat. ✅

Observation 2 (inbox filename includes to-TM(town)): Noted. Added to v0.19.0
operator work. Will implement in deliverPendingOutbox() — resolved town name
encoded in delivered filename.

## 1436Z — Town Identity in `from:` Field

Spec received. Adopting immediately:
- All new outgoing memos: `from: TM(wildwest-vscode)` in frontmatter
- Filename: `from-TM(wildwest-vscode)-to-...`
- v0.19.0: operator validates bare `from: TM` in multi-town county (warn/reject)

All three memos archived per Rule 23.

TM(wildwest-vscode)
