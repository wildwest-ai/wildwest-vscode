# TODO — wildwest-vscode

> **Last updated:** 2026-04-29 14:47 UTC (10:47 EDT)

---

## Town onboarding — `wildwest.initTown`

Initialize any repo as a `.wildwest/` governed town via a guided wizard.

- [ ] **`wildwest.initTown` command** — entry point; checks if `.wildwest/` already exists; if yes, reports current state; if no, launches wizard
- [ ] **Wizard steps:**
  1. Confirm repo is a git repo (bail early if not)
  2. Create `.wildwest/` directory structure: `telegraph/`, `scripts/`, `docs/`
  3. Create `_heartbeat` branch + worktree at `.wildwest/worktrees/_heartbeat/`
  4. Add `.wildwest/worktrees/` to `.gitignore`
  5. Summary: what was created, what the user should commit and push next
- [ ] **Self-onboard wildwest-vscode** — run `wildwest.initTown` in this repo as the first real test

Out of scope for v1: CLAUDE.md generation, registry.json, any git push.

---

## MCP integration — future

Migrate governance artifacts from local `.wildwest/` files to an MCP server. Governance capabilities become MCP tools callable by any actor regardless of editor or channel.

- [ ] **MCP server** — expose `sendMessage`, `readTelegraph`, `reportHeartbeat`, `listWorktrees`, `getSoloTier` as MCP tools
- [ ] **wildwest-vscode as MCP host** — bridge VSCode UI + file watching to the MCP transport layer
- [ ] **`.wildwest/` shrinks to runtime only** — `telegraph/`, `scripts/`, `docs/` move server-side; only `worktrees/` remains locally (fully gitignored)
- [ ] **Actor-agnostic** — Claude Code, Copilot, Codex all call the same MCP tools; no file-convention assumptions

Out of scope until governance file layer is stable.

---

## Command palette — category split

Split the flat `Wild West` category into two groups so the palette is self-organizing:

- [ ] **`Wild West: Sessions`** — Start/Stop Watcher, Export Now, Batch Convert, Convert to Markdown, Generate Index
- [ ] **`Wild West: Governance`** — Start/Stop Heartbeat, View Telegraph, Solo Mode Report

Change is purely in `package.json` `contributes.commands[*].category` — no code changes.

---

## Status bar — Wild West features

### High value, low effort

- [ ] **Active worktrees count** — add `$(git-branch) N worktrees` next to the heartbeat pill. `WorktreeManager.list()` already exists; count non-heartbeat entries.
- [ ] **Solo tier for current branch** — add `Tier N` badge to the status bar. `SoloModeController.getTier()` already computes it; just surface it. Most governance-relevant signal — an HG in Tier 4 should not be acting.
- [ ] **Current branch name** — show `$(git-branch) <branch>` via `git rev-parse --abbrev-ref HEAD`. Lets you verify which worktree VSCode considers active without leaving the editor.

### Medium value, more effort

- [ ] **Telegraph unread count** — `$(mail) N` badge when non-system files exist in `.wildwest/telegraph/`. `TelegraphWatcher` already watches the dir; count and badge.
- [ ] **Last beat age** — show `N min ago` in the heartbeat tooltip (or inline). `.last-beat` mtime is already read in `checkLiveness()`; format the age as a human string. Catches stale-but-not-yet-expired heartbeats early.
