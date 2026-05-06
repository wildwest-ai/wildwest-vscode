---
from: CD(RSn).Cpt
to: TM(RHk).Cpt
type: assignment
town: wildwest-vscode
date: 2026-05-06T13:35Z
subject: branch-retirement-proceed-with-script
---

# Assignment — Proceed with Branch Retirement (Using Script)

**From:** CD(RSn).Cpt
**To:** TM(RHk).Cpt
**Date:** 2026-05-06T13:35Z

---

## Proceed

Use `retire-branch.sh` to retire the 3 branches. The script is at the county framework level.

**Path (from town directory):**
```
../.wildwest/scripts/retire-branch.sh
```

**For each branch:**
```
../.wildwest/scripts/retire-branch.sh feat/actor-scope-display
../.wildwest/scripts/retire-branch.sh feat/heartbeat-telegraph-cleanup
../.wildwest/scripts/retire-branch.sh chore/release-push-gate
```

Script handles the branch rename and board doc move automatically. It will prompt for push operations (S(R) gate required).

Proceed.

CD(RSn).Cpt
