# DONE — wildwest-vscode

> **Last updated:** 2026-04-30 14:45 UTC (10:45 EDT)

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

---

## Native Node.js heartbeat beat ✓ shipped v0.3.1

- [x] **HeartbeatMonitor.beat() rewrite** — pure TypeScript; writes `.last-beat` sentinel via `fs.writeFileSync`, scans telegraph dir via `fs.readdirSync`; no bash script, no `_heartbeat` worktree dependency, no `exec()` call
- [x] **HeartbeatMonitor.checkLiveness()** — uses `sentinelPath()` helper pointing to main workspace `.wildwest/telegraph/.last-beat` (not worktree path)
- [x] **TownInit: remove bash script install** — `initTown` no longer installs any heartbeat script; heartbeat is fully extension-native; `HEARTBEAT_SH` template and `installHeartbeatScript()` removed

---

## Status bar worktree count + branch doc fix ✓ shipped v0.3.2

- [x] **WorktreeManager: `isMain` field** — first entry from `git worktree list` is always the main checkout; flagged so callers can exclude it
- [x] **Worktree count excludes main** — `0 wt` now means no active feature worktrees; main checkout no longer inflates the count
- [x] **Branch doc path moved** — lookup moved from `docs/branches/active/<branch>/` to `.wildwest/docs/branches/active/<branch>/`; branch docs are now part of the `.wildwest/` governance domain

---

## Multi-root workspace fix + town status board ✓ shipped v0.3.3

- [x] **HeartbeatMonitor.getTownRoot()** — scans workspace folders for the one containing `.wildwest/scripts/` (initTown marker); falls back to `folders[0]`; replaces all `folders[0]` hardcoding in `sentinelPath`, `beat`, `refreshGovCache`, `getGovInfo`
- [x] **WorktreeManager fix** — `git rev-parse` now starts from the governed folder, not arbitrary `folders[0]`; `.last-beat` writes to correct repo in multi-root workspaces
- [x] **`.wildwest/board/` — town status board** — `board/README.md` (state, queue, shipped, deferred dashboard); `board/branches/main/README.md`; `board/branches/_heartbeat/README.md`

---

## Board 4-state branch lifecycle ✓ shipped v0.3.4

- [x] **4-state lifecycle** — `planned` / `active` / `merged` / `abandoned` columns grafted into `board/branches/`
- [x] **Board updated to v0.3.4** — town status board reflects new lifecycle structure; existing branch docs reorganized accordingly

---

## Session export path — `~/wildwest/sessions/` ✓ shipped v0.4.0

- [x] **`getDefaultExportPath()` updated** — default export path changed from `~/wildwest-vscode/{username}` to `~/wildwest/sessions/{username}`; session exports now live at framework level, not scoped to the tool name
- [x] **`~/wildwest/` as single world trunk** — marks the boundary of the `~/wildwest/` world migration; sessions belong alongside counties, not inside the vscode extension folder

---

## sessionExporter.ts comment fix ✓ shipped v0.5.2

- [x] **Stale inline comment updated** — `sessionExporter.ts` line 58: `// Default: ${userHome}/wildwest-vscode/` → `${userHome}/wildwest/sessions/`

---

## README export path fix ✓ shipped v0.5.1

- [x] **README.md: stale `~/wildwest-vscode/` paths replaced** — export path description and `wildwest.exportPath` default updated to `~/wildwest/sessions/{git-username}/` to match the v0.4.0 actual behavior

---

## v3 cascading scope heartbeat ✓ shipped v0.5.0

- [x] **Multi-scope detection** — `detectScopes()` reads `scope` field from `.wildwest/registry.json`; for each town found, walks ancestor dirs to locate county and world roots; deduplicates by rootPath
- [x] **One independent timer per scope** — town, county, world each fire on their own setInterval clocks
- [x] **Interval inheritance chain** — registry `heartbeat.interval_ms` ?? VS Code extension settings ?? hardcoded floor (86400000ms / 24hr)
- [x] **Active modifier** — `hasActiveBranches()` reads `active_branches` from registry; uses `intervalActiveMs` when active
- [x] **Per-scope sentinels** — town: `telegraph/.last-beat`; county/world: `.wildwest/.last-beat`
- [x] **beatTown / beatCounty / beatWorld** — town scans telegraph flags; county checks all towns present on disk; world checks all counties present on disk
- [x] **Staleness threshold** — 2× effective intervalMs per scope
- [x] **6 new VS Code settings** — `wildwest.heartbeat.{town,county,world}.{intervalMs,intervalActiveMs}`; all default to 24hr floor
- [x] **Backward compat** — `.wildwest/scripts/` presence still recognized as pre-spec town
