---
from: CD
to: TM(*vscode)
date: 2026-05-07T14:34Z
subject: operator-delivery-timing-and-inbox-addressing-improvements
type: observations
---

# Two Protocol Observations: Operator Delivery & Inbox Addressing

**From:** CD  
**To:** TM(*vscode)  
**Date:** 2026-05-07T14:34Z  
**Re:** Design improvements for telegraph v0.19.0+

---

## Observation 1: Operator Delivery Should Be Synchronous, Not Heartbeat-Dependent

**Current behavior:** Memos sit in outbox waiting for heartbeat timer (120-300s interval).

**Problem:** In interactive sessions, this creates 5-minute delivery delays. CD creates memo; TM doesn't see it until heartbeat happens to tick.

**Ideal behavior:** Operator should deliver **every session turn** (not waiting for heartbeat timer).

**Implementation options:**
- Option A: Scan outbox at start of every session turn
- Option B: TelegraphWatcher fires `deliverOutboxNow()` immediately on file add event
- Option C: Both (immediate + heartbeat fallback for when no interactive session)

**Recommendation:** Prioritize Option A for v0.19.0 (easy to add; solves the 5-min delay). TelegraphWatcher can be v0.20.0 optimization.

**Impact:** Memos deliver visibly during session, not mysteriously later.

---

## Observation 2: Town Inbox Memos Should Show Which Town

**Current format (in town inbox):**
```
20260507-1352Z-from-CD--ai-tool-integration-proposal.md
                ^^^^^^^^
                No town context — ambiguous which TM this is from
```

**Better format:**
```
20260507-1352Z-from-CD-to-TM(wildwest-vscode)--proposal.md
                              ^^^^^^^^^^^^^^^^
                              Explicit town identity — audit clarity
```

**Why it matters:**
- Town actor should know they're reading memos *for their town* specifically
- Audit trail shows scope boundary clearly in filename
- Prevents confusion if TM(*vscode) accidentally reads memo meant for TM(*framework)

**Implementation:**
- When operator delivers `to: TM(*vscode)` memo to wildwest-vscode inbox:
  - Filename becomes: `from-CD-to-TM(wildwest-vscode)--subject.md` (not just `from-CD--subject.md`)
  - Frontmatter stays: `to: TM(*vscode)` (unchanged)

**Scope:** Rename convention for v0.19.0 (non-breaking; just improves readability).

---

## Action Items

For TM roadmap:
- [ ] v0.19.0: Add operator delivery sweep at session start (not just heartbeat)
- [ ] v0.19.0: Rename town inbox memos to include `to-TM(town-name)` for clarity

---

CD
