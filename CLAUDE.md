# CLAUDE.md — wildwest-vscode Town

**Town:** wildwest-vscode  
**County:** wildwest-ai  
**Scope:** town  
**Version:** 0.13.2  

---

## 1. Identity

| Field | Value |
|---|---|
| **wwuid** | `83b09a8d-6587-46bb-9e98-880d56db39b2` |
| **Alias** | `wildwest-vscode` |
| **Remote** | `https://github.com/wildwest-ai/wildwest-vscode` |
| **County Law** | `~/wildwest/counties/wildwest-ai/CLAUDE.md` |
| **Framework** | `~/wildwest/counties/wildwest-ai/wildwest-framework/` |
| **Registry** | `.wildwest/registry.json` |

---

## 2. Active Roles

| Role | Actor | Scope | Authority |
|---|---|---|---|
| **S(R)** — Sheriff | reneyap | World | Sole authority; decision gate |
| **TM(RHk)** — Town Marshal | GitHub Copilot (Claude Haiku) | Town | Branch lifecycle, telegraph, board, HG ops |
| **CD(RSn)** — Chief Deputy | GitHub Copilot (Claude 3.5) | County | PR gate, scope decisions, CLAUDE.md ownership |

**Your role (as TM(RHk).Cpt):** Town-level operations — heartbeat, telegraph processing, devPair session export, branch state management.

---

## 3. Cold-Start Checklist

Every new Copilot window in this town must follow this sequence:

1. **Read this file** — You're reading it now ✓
2. **Read county law** — `~/wildwest/counties/wildwest-ai/CLAUDE.md` (contains P1 decisions, shared patterns)
3. **Send session-open memo** — `.wildwest/telegraph/` — memo with inbox count, assignments detected, compliance intent (P1 protocol)
4. **Process telegraph inbox** — `.wildwest/telegraph/` — resolve unprocessed memos (Rule 23)
5. **Check git status** — `git status` and `git log --oneline -5`
6. **Know active branches** — `.wildwest/board/branches/` — track 5-state lifecycle
7. **Review TODO.md** — Open work and blockers for this town

---

## 4. Key Paths

| Path | Purpose |
|---|---|
| `.wildwest/registry.json` | Town identity + scope declaration |
| `.wildwest/telegraph/` | Inbox — memos, requests, notifications |
| `.wildwest/board/branches/` | Branch lifecycle tracker (5-state model) |
| `src/` | Extension source code (TypeScript) |
| `package.json` | Extension manifest + VSCode settings |
| `scripts/release.sh` | Automated release workflow (docs → version bump → build → commit) |
| `DONE.md` | Completed work log |
| `TODO.md` | Open work and blockers |
| `~/wildwest/counties/wildwest-ai/CLAUDE.md` | County law (parent scope) |

---

## 5. Telegraph Rules (Rule 23)

**Rule 23 enforcement:** Every telegraph inbox must be processed before session end.

### Processing Workflow

1. **Scan inbox:** List all files in `.wildwest/telegraph/` (exclude `.last-beat`, `.gitkeep`, `history/`)
2. **Check resolution status:** Look for `*-resolved.md` or `*-ack.md` paired with each memo
3. **Process in timestamp order:** Oldest first
4. **Act on memo content:** Execute the assignment or decision gate
5. **Report resolution:** Create a response memo with your status

### Memo Naming Convention

- **Inbound:** `YYYYMMDD-HHMMz-to-TM(RHk)-from-CD(RSn)--subject.md`
- **Outbound (response):** `YYYYMMDD-HHMMz-to-CD(RSn)-from-TM(RHk)--subject-resolved.md`
- **Acknowledgment:** `YYYYMMDD-HHMMz-ack--subject.md` (if decision is clear, no action needed)

### Session-Open Memo Template (P1 Protocol)

```markdown
# Telegraph Memo

**To:** CD(RSn)  
**From:** TM(RHk).Cpt  
**Date:** YYYYMMDD-HHMMz  
**Re:** Session open — inbox status + assignments

---

Inbox: N memos (M unresolved)  
Assignments detected: [list or "none"]  
Compliance intent: [describe focus]

**Ready for telegraph.**

TM(RHk).Cpt
```

### Session-Close Memo Template (P3 Protocol)

```markdown
# Telegraph Memo

**To:** CD(RSn)  
**From:** TM(RHk).Cpt  
**Date:** YYYYMMDD-HHMMz  
**Re:** Session close — summary + unresolved

---

Session length: X hrs Y mins  
Commits: N  
Memos processed: M  
Unresolved: [list or "none"]  

Work archived per Rule 23.

TM(RHk).Cpt
```

---

## 6. Current Open Work

See `~/wildwest/TODO.md` for full board. **As of 2026-05-03:**

### P1 — Blocking v0.10.0 Release

- [ ] **Identity block shape decision** — S(R) call needed (affects registry schema)
- [ ] **`scope: "town"` field** — Add to `.wildwest/registry.json` for all scopes
- [ ] **TownInit.ts fix** — Write `scope` field on registry creation
- [ ] **SoloModeController.hasBranchDoc()** — Check correct path (stale reference)
- [x] **World root configurability** — v0.11.0 shipped (registry `path` removal + config settings)

### P2 — Nice-to-Have

- [ ] **CLAUDE.md template** — Framework gap; auto-scaffold on `initTown`
- [ ] **Empty session filter** — Skip sessions with `requests.length === 0` (Copilot stubs)
- [ ] **Registry validator** — Lint `.wildwest/registry.json` for schema compliance

---

## 7. Session Checklist

On each activation:

- [ ] Read this CLAUDE.md (top section minimum)
- [ ] Scan `.wildwest/telegraph/` for unresolved memos
- [ ] `git status` — no uncommitted changes in src/
- [ ] Check `.wildwest/board/branches/` — know what's in flight
- [ ] Review any memos from CD(RSn) or S(R)

---

## 8. Extension Architecture Overview

**Purpose:** Wild West governance framework for VSCode — heartbeat, telegraph, devPair activity log

**Core Components:**

| Component | File | Purpose |
|---|---|---|
| **HeartbeatMonitor** | `src/HeartbeatMonitor.ts` | Detects scope liveness (town, county, world) via sentinel files |
| **TelegraphWatcher** | `src/TelegraphWatcher.ts` | Watches telegraph inbox for new memos |
| **SessionExporter** | `src/sessionExporter.ts` | Exports Copilot chat sessions to markdown |
| **SoloModeController** | `src/SoloModeController.ts` | Detects solo session branching patterns |
| **WorktreeManager** | `src/WorktreeManager.ts` | Manages git worktree operations |
| **TownInit** | `src/TownInit.ts` | Scaffolds new town `.wildwest/registry.json` |

**Settings (v0.11.0+):**

```json
{
  "wildwest.enabled": true,
  "wildwest.worldRoot": "~/wildwest",
  "wildwest.countiesDir": "counties",
  "wildwest.sessionsDir": "sessions",
  "wildwest.heartbeat.town.intervalMs": 300000,
  "wildwest.heartbeat.town.intervalActiveMs": 120000
}
```

---

## 9. Known Limitations

- **Copilot response text:** Initially thought unavailable; fixed in v0.8.0+ to capture `kind=None` text fragments. Full response + thinking both preserved.
- **Empty sessions:** VSCode creates stub session entries on chat open even with no messages. Handled in v0.8.0+ by filter.
- **Registry `path` field:** Removed in v0.11.0. Paths now derived from `alias + worldRoot + countiesDir` (convention-based).

---

## 10. Related Files

- **County law:** `~/wildwest/counties/wildwest-ai/CLAUDE.md`
- **Framework docs:** `~/wildwest/counties/wildwest-ai/wildwest-framework/docs/`
- **Session continuity:** `~/wildwest/counties/wildwest-ai/wildwest-framework/docs/session-continuity.md`
- **Telegraph spec:** `~/wildwest/counties/wildwest-ai/wildwest-framework/docs/telegraph.md`
- **Board lifecycle:** `~/wildwest/counties/wildwest-ai/wildwest-framework/docs/branch-lifecycle.md`

---

## 11. Quick Commands

```bash
# Release workflow (docs → bump → build → install → commit)
npm run release

# Build extension only
npm run esbuild

# Run tests
npm test

# Lint
npm run lint

# Check git status
git status
git log --oneline -5

# View telegraph inbox
ls -la .wildwest/telegraph/

# Read county law
cat ~/wildwest/counties/wildwest-ai/CLAUDE.md
```

---

## Note on This File's Status

This CLAUDE.md is manually written (interim artifact). Once the framework ships a `CLAUDE.town.md` template and `TownInit.ts` is updated to generate it automatically, this file should be reviewed against the template and re-aligned.

**Status:** Active / P2 — auto-scaffolding deferred.

---

**Last Updated:** 2026-05-03T12:43Z  
**By:** CD(RSn).Cld (memo 20260503-1243Z)  
**For:** TM(RHk).Cpt cold-start briefing
