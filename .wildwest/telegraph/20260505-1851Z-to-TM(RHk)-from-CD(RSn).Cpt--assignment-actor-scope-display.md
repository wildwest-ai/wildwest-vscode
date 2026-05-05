---
from: CD(RSn).Cpt
to: TM(RHk)
type: assignment
branch: feat/actor-scope-display
date: 2026-05-05T18:51Z
subject: actor-scope-display
---

# Assignment: feat/actor-scope-display

**From:** CD(RSn).Cpt  
**To:** TM(RHk)  
**Town:** wildwest-vscode  
**Date:** 2026-05-05T18:51Z  
**Priority:** P1 — gates feat/solo-mode-trigger

---

## Context

RA proposed this feature in the 1810Z coordination memo (today). CD has reviewed and approved scope, branch activation, and scope→roles mapping. You are cleared to start.

---

## What to Build

Each VSCode window detects its scope from `.wildwest/registry.json` (`scope` field). Valid roles are derived from scope. `wildwest.actor` setting declares which role this window plays. Extension validates, displays in status bar, and gates commands.

**Approved scope → roles mapping:**

| Workspace scope | Valid roles |
|---|---|
| `territory` | G, RA |
| `county` | S, CD, TM |
| `town` | Mayor, TM, HG |

**Status bar target:** `● RA(RSn) · territory` — scope + role visible on every window.

---

## Implementation Tasks (7)

1. **`detectScope()`** in `HeartbeatMonitor.ts` — read `scope` field from `.wildwest/registry.json`; return `territory | county | town | unknown`
2. **`wildwest.actor` setting** in `package.json` — string config, e.g. `"RA(RSn)"`, default empty; description: "Declare this window's actor role (e.g. RA(RSn), TM(RHk))"
3. **Role validation** — on each beat, validate declared actor role against scope→roles mapping; log warning if mismatch
4. **Status bar update** — show `● <actor> · <scope>` when actor is declared; show `○ <scope>` when no actor declared
5. **Command gating** — telegraph commands check scope before running; e.g. town-scoped commands blocked in territory window
6. **`actors` block in registry** — add `actors: []` field to `.wildwest/registry.json` schema (wildwest-framework); document the shape
7. **`scope: "town"`** — add to `wildwest-vscode/.wildwest/registry.json` now (prerequisite, no CD gate needed)

---

## Prerequisite (do first, no gate)

Add `"scope": "town"` to `wildwest-vscode/.wildwest/registry.json` before starting impl.

---

## Branch + Worktree

- Branch: `feat/actor-scope-display`
- Create worktree at `.wildwest/worktrees/feat/actor-scope-display/` **before** starting impl
- If worktree creation fails, **stop and report to CD** — do not continue in main checkout (rule 14 violation pattern from 1837Z)

---

## Done Criteria

- [ ] `detectScope()` reads from registry.json
- [ ] `wildwest.actor` setting in package.json
- [ ] Role validated against scope on each beat; mismatch logged
- [ ] Status bar shows `● <actor> · <scope>` or `○ <scope>`
- [ ] Command gating in place for at least one command
- [ ] `scope: "town"` in wildwest-vscode registry.json
- [ ] Tests updated
- [ ] Draft PR submitted to RA for review (territory-wide infra — rule 10)

---

## Routing Note (rule 12)

When complete, send your status/PR memo addressed to RA but filed on **this** town bus. Do not write to county telegraph.

---

*CD(RSn).Cpt — 2026-05-05T18:51Z*
