# Board — wildwest-vscode

> **Last updated:** 2026-04-30 11:28 UTC
> **Town:** wildwest-vscode
> **Repo:** https://github.com/wildwest-ai/wildwest-vscode

---

## Town State

| Field | Value |
|---|---|
| Version | 0.3.2 |
| Branch | main |
| Heartbeat | ● alive (native Node.js) |
| Solo Tier | T1 — no active feature branch |
| Active worktrees | 0 (main + _heartbeat only) |

---

## Active Branches

_None. All work is on `main`._

See `board/branches/` for lifecycle docs.

---

## Queue (next up)

| ID | Item | Notes |
|---|---|---|
| B5 | Command palette split | `package.json` only — no code |
| B4 | Last beat age in tooltip | Low effort, high signal |
| B3 | Telegraph unread badge | TelegraphWatcher already in place |
| B2 | Branch doc creation command | T1→T2 upgrade path; needs UI |
| B1 | Heartbeat log | Per-branch daily log in telegraph |

---

## Recently Shipped

| Version | Commit | What |
|---|---|---|
| v0.3.2 | `0800e03` | Exclude main worktree from count; branch doc → `.wildwest/docs/branches/` |
| v0.3.1 | `c5a55f6` | Heartbeat rewritten as native Node.js; async govCache |
| v0.3.0 | `5a3882b` | Status bar governance dashboard (branch, tier, worktree count) |
| v0.2.4 | `462c1b2` | initTown: always show repo picker; prune stale worktrees |
| v0.2.0 | `5becc98` | wildwest.initTown wizard |

---

## Deferred

| Item | Reason |
|---|---|
| MCP integration | Blocked — governance file layer must stabilize first |
