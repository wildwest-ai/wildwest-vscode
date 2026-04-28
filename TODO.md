# TODO — wildwest-vscode

> **Last updated:** 2026-04-28 22:33 UTC (18:33 EDT)

---

## Status bar — Wild West features

### High value, low effort

- [ ] **Active worktrees count** — add `$(git-branch) N worktrees` next to the heartbeat pill. `WorktreeManager.list()` already exists; count non-heartbeat entries.
- [ ] **Solo tier for current branch** — add `Tier N` badge to the status bar. `SoloModeController.getTier()` already computes it; just surface it. Most governance-relevant signal — an HG in Tier 4 should not be acting.
- [ ] **Current branch name** — show `$(git-branch) <branch>` via `git rev-parse --abbrev-ref HEAD`. Lets you verify which worktree VSCode considers active without leaving the editor.

### Medium value, more effort

- [ ] **Telegraph unread count** — `$(mail) N` badge when non-system files exist in `.wildwest/telegraph/`. `TelegraphWatcher` already watches the dir; count and badge.
- [ ] **Last beat age** — show `N min ago` in the heartbeat tooltip (or inline). `.last-beat` mtime is already read in `checkLiveness()`; format the age as a human string. Catches stale-but-not-yet-expired heartbeats early.
