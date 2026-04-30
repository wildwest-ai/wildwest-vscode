# DONE — wildwest-vscode

> **Last updated:** 2026-04-29 15:23 UTC (11:23 EDT)

---

## Town onboarding — `wildwest.initTown` ✓ shipped v0.2.4

- [x] **`wildwest.initTown` command** — entry point; checks if `.wildwest/` already exists; if yes, reports current state; if no, launches wizard
- [x] **Wizard steps:**
  1. Confirm repo is a git repo (bail early if not)
  2. Create `.wildwest/` directory structure: `telegraph/`, `scripts/`, `docs/`
  3. Create `_heartbeat` branch + worktree at `.wildwest/worktrees/_heartbeat/`
  4. Add `.wildwest/worktrees/` to `.gitignore`
  5. Summary: what was created, what the user should commit and push next
- [x] **Self-onboard wildwest-vscode** — ran `wildwest.initTown` in this repo as the first real test

---

## Status bar governance dashboard ✓ shipped v0.3.0

- [x] **Active worktrees count** — `N wt` shown in heartbeat pill; non-heartbeat entries from `WorktreeManager.list()`
- [x] **Solo tier for current branch** — `T1`/`T2`/`T4` badge in heartbeat pill; computed from heartbeat state + branch doc presence
- [x] **Current branch name** — `$(git-branch) <branch>` in heartbeat pill via `git rev-parse --abbrev-ref HEAD`
- [x] **WorktreeManager.getRepoRoot() bugfix** — was setting `repoRoot = '.git'` when opened from main worktree (not a linked one); `git-common-dir` returns relative path in main worktree, absolute in linked — fixed with `path.isAbsolute()` guard
- [x] **.vscodeignore fix** — `.wildwest/worktrees/**` was being bundled into VSIX (483 KB of _heartbeat worktree data); excluded via `.vscodeignore`
