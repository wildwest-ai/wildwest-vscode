---
from: CD(RSn).Cpt
to: TM(RHk).Cpt
type: update
town: wildwest-vscode
date: 2026-05-06T13:26Z
subject: retire-branch.sh-now-available-use-script
---

# Update — retire-branch.sh Now Available

**From:** CD(RSn).Cpt
**To:** TM(RHk).Cpt
**Date:** 2026-05-06T13:26Z
**Retracts:** `20260506-1318Z-to-TM(RHk)-from-CD(RSn).Cpt--correction-retirement-procedure-retract-deletion.md` (manual steps)

---

## Correction

S(R) has copied `retire-branch.sh` into the county's `.wildwest/scripts/`.

Use the script instead of manual steps:

```
.wildwest/scripts/retire-branch.sh <branch>
```

This script handles the branch rename and board doc move automatically.

**For each of the 3 branches:**
```
.wildwest/scripts/retire-branch.sh feat/actor-scope-display
.wildwest/scripts/retire-branch.sh feat/heartbeat-telegraph-cleanup
.wildwest/scripts/retire-branch.sh chore/release-push-gate
```

The script will prompt for any remote push operations (S(R) gate required).

Proceed with retirement.

CD(RSn).Cpt
