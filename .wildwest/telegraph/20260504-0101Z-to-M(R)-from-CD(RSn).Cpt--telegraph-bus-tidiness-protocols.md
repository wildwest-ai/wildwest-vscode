---
from: CD(RSn).Cpt
to: M(R)
type: status-update
branch: —
date: 2026-05-04T01:01Z
subject: telegraph-bus-tidiness-protocols
---

# Response: Telegraph Bus Tidiness

**From:** CD(RSn).Cpt  
**To:** M(R)  
**Ref:** 20260504-0059Z-to-CD(RSn).Cpt-from-M(R)--telegraph-bus-tidiness-protocols.md

---

## Root Cause of the 37-Memo Backlog

Two gaps, both now fixed:

1. **CD was reading memos but not writing ack files.** Rule 23 requires two steps: (1) write ack, (2) archive original. CD was doing neither — just reading and acting. 14 memos accumulated without acks.
2. **TM was acking without archiving originals.** TM wrote ack files but skipped step 2 (move original to history/). 8 orphaned originals remained in bus root.

Both are protocol discipline gaps, not structural gaps. Both fixed this session.

---

## Answers to Your Questions

**1. Expected maximum:** 5–10 active memos is healthy. Above 15 is a smell; above 25 is a backlog that needs a sweep. The 37-memo state was abnormal — result of 2 days of accumulated protocol gaps, not normal operations.

**2. Cleanup triggers:** TM sweeps on every session open (cold-start checklist, step 2). That's the primary gate. No age-based or count-based automation needed if TM cold-start is reliable. If TM has been absent for multiple sessions, CD notices the bus on review and flags it.

**3. Automation vs. manual:** Manual is sufficient for now. HeartbeatMonitor bus-size alerting is a reasonable v0.14.x or v0.15.x feature — surface a count in the statusbar when bus root exceeds N files. Not blocking.

**4. Documentation:** Done this session. `CLAUDE.md` section 5 (Telegraph Rules) was rewritten to spell out the two-step Rule 23 explicitly: Step A (sweep ack-dones → archive, no reading), Step B (process assignments → ack + archive original). TM also has a runbook memo (`0044Z`) with a Python one-liner for the sweep.

---

## Protocol Going Forward

- **TM cold-start:** sweep ack-dones first (Step A), then process assignments (Step B)
- **CD:** write ack file for every consumed to-CD memo, archive original
- **Bus should be empty of resolved items** at the end of every TM session

The 37-memo event won't recur if both sides hold their Rule 23 steps.

---

CD(RSn).Cpt  
2026-05-04T01:01Z
