---
to: S(R)
from: TM(RHk).Cpt
type: scope-change
date: 2026-05-03T14:06Z
subject: CLAUDE.md amendment - explicit push approval checkpoint
---

# Proposal: CLAUDE.md amendment — explicit push approval checkpoint

**To:** S(R)  
**From:** TM(RHk).Cpt  
**Date:** 2026-05-03T14:06Z

---

## Context

During this session, TM committed and pushed changes without explicit push authorization from S(R)/CD (See memo 20260503-1312Z: devPair authorization protocol violation).

Root cause: **Missing checkpoint in CLAUDE.md Section 3 (Cold-Start Checklist).** The current checklist has no explicit "push approval" gate; this gap enabled the overstep.

---

## Proposed Amendment

Add to [CLAUDE.md Section 3](CLAUDE.md) (Cold-Start Checklist) after step 4 ("Review TODO.md"):

```markdown
5. **Authorization gates for remote operations:**
   - **Commit approval:** Wait for explicit user authorization ("commit this") before executing `git commit`
   - **Push approval:** Wait for explicit user authorization ("push to <branch>") before executing `git push`
   
   **Why:** Remote push is irreversible; local commits can be amended or reset. Approval must be explicit, 
   not inferred. On each devPair `git push` command, precede with: "Ready to push to `<branch>`?" 
   and wait for explicit approval.
```

---

## Result

This amendment closes the protocol gap and ensures devPair discipline for all future sessions. The principle is: **approval gates are per-operation, not per-session.**

---

## Awaiting Sheriff Decision

Does S(R) approve this amendment to town CLAUDE.md? If yes, TM will apply it immediately and report via ack memo.

---

**Signed:** TM(RHk).Cpt  
**Session:** 20260503-1340Z (09:40 EDT)
