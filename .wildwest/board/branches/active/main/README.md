# main — Branch Doc

> **Last updated:** 2026-04-30 12:06 UTC
> **Status:** 🔄 Active — permanent integration + release branch
> **Created:** repo init — R (reneyap)
> **Type:** integration / release
> **Owner:** R (reneyap)
> **Base branch:** N/A — root branch

---

## Purpose

**Problem:** Every feature and fix needs a stable, always-releasable integration point.

**Solution:** `main` is the permanent base. All feature branches branch from and merge back to `main`. Releases are tagged here.

---

## Scope

### In Scope
- All merged feature and fix work
- Version tags and GitHub releases
- Extension artifacts (`build/*.vsix`)

### Out of Scope
- Direct feature development — always on a feature branch
- Heartbeat operations — delegated to `_heartbeat` worktree

---

## Done Criteria

- [ ] All CI checks pass before merge
- [ ] Version bump in `package.json` + TownInit label on every release commit
- [ ] `.vsix` artifact committed to `build/`
- [ ] GitHub release created with release notes

---

## Living Sections

### Status

Stable. v0.3.4 in progress.

### Recent Releases

| Version | Commit | What |
|---|---|---|
| v0.3.3 | `756f087` | Multi-root workspace town detection (getTownRoot) |
| v0.3.2 | `0800e03` | Exclude main worktree from count; branch doc → .wildwest/ |
| v0.3.1 | `c5a55f6` | Native Node.js heartbeat; async govCache |
| v0.3.0 | `5a3882b` | Status bar governance dashboard |

### Actor Assignment

**RSn — reneyap + Claude Sonnet (Claude Code)**
Primary development dyad. All governance and feature work.
