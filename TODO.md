# TODO — wildwest-vscode

> **Last updated:** 2026-05-01 16:30 UTC (12:30 EDT)

---

## staged/ — continuous incremental sync (fixed v0.7.1)

`staged/` is the interim MCP proxy. The v0.6.0 auto-sync ran once at startup only — active
sessions updated after startup were never re-converted. Spotted when reading TM session 54f60505:
raw/ had the latest content (12:36) but staged/ was stale (synced at 11:56).

**Fix (v0.7.1):** fire `batchConvertSessions(true)` at the end of each `checkAllChatSessions()`
poll cycle when activity is detected. `BatchChatConverter.isAlreadyConverted()` already uses mtime
checks — only changed files are re-converted. staged/ now lags raw/ by at most one 5s poll cycle.

---

## vsix — output to build/ only (fixed v0.7.1)

Root vsix files (0.5.5, 0.6.0, 0.7.0) were left in repo root — `.gitignore` correctly ignores
root `*.vsix` and tracks only `build/*.vsix`. Root strays moved to `build/` in v0.7.1.
`npm run package` uses `--out build/` — always use it, never bare `vsce package`.

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
