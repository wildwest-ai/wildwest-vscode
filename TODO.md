# TODO — wildwest-vscode

> **Last updated:** 2026-04-30 14:45 UTC (10:45 EDT)

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

### Medium value, more effort

- [ ] **Telegraph unread count** — `$(mail) N` badge when non-system files exist in `.wildwest/telegraph/`. `TelegraphWatcher` already watches the dir; count and badge.
- [ ] **Last beat age** — show `N min ago` in the heartbeat tooltip (or inline). `.last-beat` mtime is already read in `checkLiveness()`; format the age as a human string. Catches stale-but-not-yet-expired heartbeats early.
