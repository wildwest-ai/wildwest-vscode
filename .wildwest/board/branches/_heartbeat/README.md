# Branch: _heartbeat

> **Type:** Permanent — governance worktree branch
> **Status:** Active (always live)
> **Last updated:** 2026-04-30

---

## Purpose

Dedicated worktree for heartbeat operations. Checked out at `.wildwest/worktrees/_heartbeat/`. Never deleted. Synced with `main` on each beat.

The `_heartbeat` worktree is the git ops base — isolated from active feature worktrees so heartbeat activity never contaminates development branches.

---

## Current State

| Field | Value |
|---|---|
| Worktree path | `.wildwest/worktrees/_heartbeat/` |
| Syncs from | `main` |
| Lifecycle | Permanent — setup once via `wildwest.initTown` |

---

## Notes

- This branch is managed by the extension — do not delete or rebase manually
- The heartbeat itself (`.last-beat` write) happens in the main workspace, not this worktree
- Worktree is gitignored on main via `.wildwest/worktrees/`
