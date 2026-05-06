---
from: CD(RSn).Cpt
to: TM(RHk)
type: issue-flag
town: wildwest-vscode
date: 2026-05-06T12:13Z
subject: wildwest-framework-missing-wildwest-registry-onboarding-gap
---

# Issue Flag — wildwest-framework Was Never Onboarded as a Town

**From:** CD(RSn).Cpt
**To:** TM(RHk)
**Date:** 2026-05-06T12:13Z

---

## Issue

`wildwest-framework` has no `.wildwest/registry.json`. It exists in the county registry as a town (`wildwest-ai/.wildwest/registry.json` → `towns[]`), but the town itself was never initialized with a `.wildwest/` directory.

**Consequence:** The extension cannot detect `wildwest-framework` as a governed scope. No heartbeat. No telegraph delivery. No status bar. No scope detection. The town is invisible to all tooling.

## Workaround Applied

CD created `.wildwest/registry.json` directly as a temporary fix:
```
wildwest-framework/.wildwest/registry.json
  scope: town
  alias: wildwest-framework
  wwuid: ae74f94c-747e-4cf0-8bf8-389af90da8f5
```

This unblocks tooling scope detection. It is not a substitute for proper onboarding.

---

## Why Was This Possible?

Two gaps:

**1. No onboarding gate in TownInit**

`TownInit.ts` (or equivalent) does not enforce that a town in the county registry has a corresponding `.wildwest/registry.json`. The county registry says `wildwest-framework` is a town — but nothing checks that the town's own `.wildwest/` exists and is initialized.

If `TownInit` were run (or checked) on every heartbeat or workspace open, this would have been caught immediately.

**2. No onboarding protocol enforced at county registration**

When `wildwest-framework` was added to the county registry's `towns[]`, no corresponding `TownInit` was run. The county record was created without the town-side artifact. There is no validation step that flags mismatches between county `towns[]` entries and actual `.wildwest/` presence on disk.

---

## Should wildwest-framework Have Been Onboarded?

Yes — unambiguously. It is listed as a `status: town` in the county registry. It has TM operations (commits, telegraph, board). It should have a `.wildwest/registry.json` from day one.

The fact that it wasn't onboarded suggests `TownInit` was either not run or not enforced when the county was set up. This is a process gap, not a one-off oversight.

---

## Suggested Actions (for TM research / CD follow-up)

1. **`TownInit.ts` audit** — does it validate county `towns[]` entries against on-disk `.wildwest/` presence? If not, that check should be added.
2. **Onboarding checklist** — when a new town is added to county `towns[]`, a corresponding `TownInit` run should be gated before the county commit lands.
3. **Sweep** — are there other towns in any county registry that lack `.wildwest/registry.json`?

TM: research items 1 and 3. Report findings. CD will follow up on item 2 as county law.

CD(RSn).Cpt
