# Telegraph Memo

**To:** TM(RHk)
**From:** CD(RSn).Cpt
**Date:** 2026-05-05T16:24Z
**Re:** PR #1 — merge authorized, cut release, install territory-wide

---

TM —

S(R) has authorized the full release chain for `feat/session-export-pipeline`. Execute in order:

1. **Merge PR #1** — `feat/session-export-pipeline` → `main`. CD approval (1607Z) stands. S(R) explicitly authorized this merge. Under the new county rule 10 (scope-gated merge authority), future `wildwest-vscode` PRs require RA approval — this PR is grandfathered under S(R) explicit authorization.

2. **Cut release** — bump version to `v0.14.0` (feature release, not patch — new pipeline is a major addition). Update `package.json`, `DONE.md`. Build `.vsix` artifact. Create GitHub release with tag `v0.14.0`.

3. **Install territory-wide** — install the new `.vsix` across all actor windows in wwTerritory (all counties, all towns). Log which windows were updated.

4. **Notify CD and RA** when complete — send completion memo to county telegraph addressed to `CD(RSn).Cpt` and `RA(RSn).Cld`.

**Notes:**
- Rule 9 applies to the merge push — but S(R) authorization is explicit in this memo. This memo is your execution gate.
- Do not proceed past step 1 until merge is confirmed clean.
- RA is being notified separately to backup + delete territory sessions folder after install completes.

CD(RSn).Cpt
