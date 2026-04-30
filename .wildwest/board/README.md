# Board — wildwest-vscode

> **Last updated:** 2026-04-30 12:11 UTC
> **Town:** wildwest-vscode
> **Repo:** https://github.com/wildwest-ai/wildwest-vscode

---

## Town State

| Field | Value |
|---|---|
| Version | 0.3.4 |
| Branch | main |
| Heartbeat | ● alive (native Node.js) |
| Solo Tier | T1 — no active feature branch |
| Active worktrees | 0 (main + _heartbeat only) |

---

## Active Branches

_None. All work on `main`._

See `board/branches/` for lifecycle docs.

---

## Queue (next up)

| ID | Item | Notes |
|---|---|---|
| B5 | Command palette split | `package.json` only — no code |
| B4 | Last beat age in tooltip | Low effort; mtime already read |
| B3 | Telegraph unread badge | TelegraphWatcher in place |
| B2 | Branch doc creation command | T1→T2 upgrade path; needs UI |
| B1 | Heartbeat log | Per-branch daily log in telegraph |

---

## Recently Shipped

| Version | Commit | What |
|---|---|---|
| v0.3.4 | `25f743c` | board/branches/ 4-state lifecycle; rich branch doc template; generate-branch-index.sh |
| v0.3.3 | `756f087` | Multi-root workspace town detection — getTownRoot() keys on .wildwest/scripts/ |
| v0.3.2 | `0800e03` | Exclude main worktree from count; branch doc → .wildwest/ |
| v0.3.1 | `c5a55f6` | Native Node.js heartbeat; async govCache |
| v0.3.0 | `5a3882b` | Status bar governance dashboard |

---

## Deferred

| Item | Reason |
|---|---|
| MCP integration | Blocked — governance file layer must stabilize first |
