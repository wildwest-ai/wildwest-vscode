# _heartbeat — Branch Doc

> **Last updated:** 2026-04-30 12:06 UTC
> **Status:** 🔄 Active — permanent governance worktree branch
> **Created:** repo init — R (reneyap)
> **Type:** ops / governance
> **Owner:** R (reneyap)
> **Base branch:** main (synced on each beat)

---

## Purpose

**Problem:** Heartbeat operations need isolation from active development worktrees so governance activity never contaminates feature branches.

**Solution:** `_heartbeat` is a permanent dedicated worktree branch, checked out at `.wildwest/worktrees/_heartbeat/`. Never deleted. The extension treats it as the git ops base for all heartbeat-related work.

---

## Scope

### In Scope
- Permanent `_heartbeat` worktree at `.wildwest/worktrees/_heartbeat/`
- Sync with `main` on each beat
- Git ops isolation for heartbeat

### Out of Scope
- Feature development — never commits code here
- `.last-beat` write — this happens in the main workspace, not the worktree
- Manual rebasing or deletion

---

## Done Criteria

- [ ] `_heartbeat` branch exists
- [ ] Worktree checked out at `.wildwest/worktrees/_heartbeat/`
- [ ] `.wildwest/worktrees/` in `.gitignore`
- [ ] Extension detects worktree via `WorktreeManager` (`isHeartbeat: true`)

---

## Living Sections

### Status

Operational. Worktree live. Extension excludes it from worktree count.

### Notes

- Managed by the extension — do not delete or rebase manually
- `.last-beat` is written to `main` workspace `.wildwest/telegraph/`, not to this worktree
- `WorktreeManager.parse()` detects via `path.basename(wtPath) === '_heartbeat'`

### Actor Assignment

**RSn — reneyap + Claude Sonnet (Claude Code)**
Governance infra — managed by extension lifecycle.
