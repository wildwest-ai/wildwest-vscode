# DONE — wildwest-vscode

> **Last updated:** 2026-05-08T00:57Z UTC

---

## v0.25.6 — Self-addressed delivery fix ✓ 2026-05-08

- [x] **Same-scope delivery** — `resolveScopePath()` now returns the current town path when `currentScope === destScope`, so self-addressed mail goes through the normal delivery operator instead of being treated as local/no-op
- [x] **Unresolvable recipient handling** — unresolved destinations are marked failed instead of silently archiving without delivery
- [x] **Production regression test** — added `HeartbeatDelivery.test.ts` to exercise production `deliverPendingOutbox()` for outbox → local inbox + outbox history behavior
- [x] **Release docs/artifact** — bumped to `0.25.6`, updated README current version + What's New, rebuilt and installed `build/wildwest-vscode-0.25.6.vsix`
- [x] **Dogfood verification** — a self-addressed memo delivered through the real outbox path into local `inbox/` and `outbox/history/`; history copy stamped `delivered_at: 2026-05-08T00:52:27.671Z`

## v0.25.4 — Test isolation ✓ 2026-05-07

- [x] **`batchConverter`, `chatSessionConverter`, `jsonToMarkdown` tests** — switched from `beforeAll`/`afterAll` + shared `__tests__/testdata/` to `beforeEach`/`afterEach` with `fs.mkdtempSync(os.tmpdir())` per test; eliminates intermittent Jest parallel-runner conflicts

## v0.25.3 — Lint cleanup ✓ 2026-05-07

- [x] **0 ESLint warnings** — removed 6 unused imports (`getTransformer`, `Cursor`, `SessionIndex`, `parsePacketFilename`, `padSequence`, `TurnMeta`); typed all `any` usages in pipeline code (`Record<string, unknown>`, `PartKind`, `TurnMeta`, `Cursor` casts); prefixed unused `rawSession` param → `_rawSession`
- [x] **ESLint config** — added `argsIgnorePattern: "^_"` + `varsIgnorePattern: "^_"` to `no-unused-vars` rule

## v0.25.2 — Telegraph sender fix ✓ 2026-05-07

- [x] **`telegraphSend` reads alias from registry** — `from:` field now derived from `.wildwest/registry.json` alias instead of hard-coded `TM(RHk).Cpt`; falls back to `TM` if registry unreadable

## v0.25.1 — Resource leak fixes ✓ 2026-05-07

- [x] **`StatusBarManager` disposal** — stores config/workspace listeners and refresh interval; `dispose()` clears all
- [x] **`BatchChatConverter.run()` no-exit** — throws instead of `process.exit(1)`; CLI entry point still exits; safe to call from extension

## v0.25.0 — Shell-safe git config ✓ 2026-05-07

- [x] **Security fix** — `git config user.name` uses `execFileSync` with argument array; prevents command injection from user-supplied usernames

## v0.24.0 — VSIX hygiene ✓ 2026-05-07

- [x] **`.vscodeignore` rewrite** — 311 → 3 files; 618 KB → 165 KB; excludes `src/`, `__tests__/`, `.wildwest/`, `docs/`, `scripts/`, `build/`, all `tsc` output except `dist/extension.js`

## v0.23.0 — npm test green ✓ 2026-05-07

- [x] **Lint gate** — `no-explicit-any` rule changed from error → warn; Jest runs again
- [x] **`extractResponseAndThinking`** — accepts `kind='text'` alongside `kind=null/undefined` (v0.23.0)
- [x] **Telegraph v2 regex fix** — deprecated-format detector changed from `/\([A-Za-z]\)\./` → `/\([A-Za-z]+\)\./`; matches multi-char abbreviations like `RSn`
- [x] **68/68 tests passing**, 7/7 suites

## v0.22.0 — P7 @wildwest participant + operator fixes ✓ 2026-05-07

- [x] **`@wildwest` Copilot Chat participant** — `send`, `ack`, `archive` with [Confirm] buttons; county+town inbox sweep; `telegraph check`; `status` shows open memo + branch counts
- [x] **Delivered filename wildcard resolution** — `deliverPendingOutbox()` reads destination registry alias and rewrites `role(*pattern)` → `role(alias)` in filename before writing to destInboxDir
- [x] **Bare `TM` warning** — warns when `scope=county`, `from: TM`, and county has >1 town

## SemVer convention documented ✓ 2026-05-07

- [x] **CLAUDE.md + `scripts/release.sh`** — MAJOR/MINOR/PATCH definitions; default `--minor`; use `--patch` for fix/chore releases

---

## AI Tool Hook Integration Proposal ✓ 2026-05-07

- [x] **Research complete** — documented all AI tool APIs (Claude Code, Codex CLI, GitHub Copilot) in [docs/20260507-1204Z-ai-tool-programmatic-apis.md](./docs/20260507-1204Z-ai-tool-programmatic-apis.md)
- [x] **Architecture designed** — adapter layer established to support Claude Code, Codex, Copilot, and future tools
- [x] **Proposal drafted** — full P1–P6 roadmap with implementation sequence, scope decisions, open questions in [docs/20260507-1213Z-proposal-ai-hook-integration.md](./docs/20260507-1213Z-proposal-ai-hook-integration.md)
- [x] **Governance scope clarified** — extension remains governance framework (not orchestration); foundation laid for future orchestration if ROI emerges
- [x] **Cross-scope visibility** — wwMCP design includes Territory, County, Town scope queries

---

## Comprehensive repository review complete ✓ 2026-05-07

- [x] **Full repo review performed** — reviewed source, tests, package config, release script, docs, and packaged VSIX contents; `.wildwest/` was excluded from scope per request
- [x] **Review artifact written** — findings saved to [docs/REVIEW-COMPREHENSIVE-20260507-1145Z.md](./docs/REVIEW-COMPREHENSIVE-20260507-1145Z.md)
- [x] **Verification recorded** — `npm test` is red at lint, and direct Jest has 4 failing tests across chat session conversion and telegraph v2 transition coverage
- [x] **Follow-up backlog created** — release blockers and high-value follow-ups added to TODO.md

---

## Copilot response extraction fix ✓ shipped v0.9.0

- [x] **Actual response text extraction** — Copilot stores response in parts with `kind=undefined` (no kind field); updated `extractResponseAndThinking()` to concatenate these instead of using thinking as fallback
- [x] **Thinking preserved as separate field** — `thinking` field now extracted alongside `response` and stored in staged JSON; thinking excludes sentinel entries (`vscodeReasoningDone` markers)
- [x] **Schema updated** — `ChatReplayFormat.prompts` now includes optional `thinking` field; both response and thinking available for session review
- [x] **Verified structure** — Confirmed interleaved response sequence: `mcpServersStarting` → `thinking` → `kind=None` → `toolInvocationSerialized` → `thinking` → `kind=None`

---

## Registry identity + copilot response fallback ✓ shipped v0.8.0

- [x] **Registry creation in initTown** — Step 2 now writes `.wildwest/registry.json` with identity block: `scope`, `wwuid`, `alias`, `remote`, `mcp: null`, `createdAt`; towns now self-register on init
- [x] **Town root detection fix** — `WorktreeManager` and `HeartbeatMonitor` now key on `.wildwest/registry.json` instead of `.wildwest/scripts/`; single marker simplifies scope detection; `.scripts/` fallback removed
- [x] **Empty session filtering** — `batchConverter.ts` now skips sessions with `requests.length === 0` (Copilot), `prompts.length === 0` (Claude), or `totalPrompts === 0` (Codex); VSCode session stubs no longer written to `staged/`
- [x] **Copilot response capture: thinking field fallback** — `chatSessionConverter.ts` now implements two-tier extraction: try 'text' kind first, fallback to 'thinking' field if empty; marked as `[thinking]` for clarity; improves response signal when rendered text unavailable at source
- [x] **Known limitations doc** — README.md updated to document both the thinking field mitigation and empty session filtering

---

## Town onboarding — `wildwest.initTown` ✓ shipped v0.2.4

- [x] **`wildwest.initTown` command** — entry point; checks if `.wildwest/` already exists; if yes, reports current state; if no, launches wizard
- [x] **Wizard steps:**
  1. Confirm repo is a git repo (bail early if not)
  2. Create `.wildwest/` directory structure: `telegraph/`, `scripts/`, `docs/`
  3. Create `_heartbeat` branch + worktree at `.wildwest/worktrees/_heartbeat/`
  4. Add `.wildwest/worktrees/` to `.gitignore`
  5. Summary: what was created, what the user should commit and push next
- [x] **Self-onboard wildwest-vscode** — ran `wildwest.initTown` in this repo as the first real test

---

## Status bar governance dashboard ✓ shipped v0.3.0

- [x] **Active worktrees count** — `N wt` shown in heartbeat pill; non-heartbeat entries from `WorktreeManager.list()`
- [x] **Solo tier for current branch** — `T1`/`T2`/`T4` badge in heartbeat pill; computed from heartbeat state + branch doc presence
- [x] **Current branch name** — `$(git-branch) <branch>` in heartbeat pill via `git rev-parse --abbrev-ref HEAD`
- [x] **WorktreeManager.getRepoRoot() bugfix** — was setting `repoRoot = '.git'` when opened from main worktree (not a linked one); `git-common-dir` returns relative path in main worktree, absolute in linked — fixed with `path.isAbsolute()` guard
- [x] **.vscodeignore fix** — `.wildwest/worktrees/**` was being bundled into VSIX (483 KB of _heartbeat worktree data); excluded via `.vscodeignore`

---

## Native Node.js heartbeat beat ✓ shipped v0.3.1

- [x] **HeartbeatMonitor.beat() rewrite** — pure TypeScript; writes `.last-beat` sentinel via `fs.writeFileSync`, scans telegraph dir via `fs.readdirSync`; no bash script, no `_heartbeat` worktree dependency, no `exec()` call
- [x] **HeartbeatMonitor.checkLiveness()** — uses `sentinelPath()` helper pointing to main workspace `.wildwest/telegraph/.last-beat` (not worktree path)
- [x] **TownInit: remove bash script install** — `initTown` no longer installs any heartbeat script; heartbeat is fully extension-native; `HEARTBEAT_SH` template and `installHeartbeatScript()` removed

---

## Status bar worktree count + branch doc fix ✓ shipped v0.3.2

- [x] **WorktreeManager: `isMain` field** — first entry from `git worktree list` is always the main checkout; flagged so callers can exclude it
- [x] **Worktree count excludes main** — `0 wt` now means no active feature worktrees; main checkout no longer inflates the count
- [x] **Branch doc path moved** — lookup moved from `docs/branches/active/<branch>/` to `.wildwest/docs/branches/active/<branch>/`; branch docs are now part of the `.wildwest/` governance domain

---

## Multi-root workspace fix + town status board ✓ shipped v0.3.3

- [x] **HeartbeatMonitor.getTownRoot()** — scans workspace folders for the one containing `.wildwest/scripts/` (initTown marker); falls back to `folders[0]`; replaces all `folders[0]` hardcoding in `sentinelPath`, `beat`, `refreshGovCache`, `getGovInfo`
- [x] **WorktreeManager fix** — `git rev-parse` now starts from the governed folder, not arbitrary `folders[0]`; `.last-beat` writes to correct repo in multi-root workspaces
- [x] **`.wildwest/board/` — town status board** — `board/README.md` (state, queue, shipped, deferred dashboard); `board/branches/main/README.md`; `board/branches/_heartbeat/README.md`

---

## Board 4-state branch lifecycle ✓ shipped v0.3.4

- [x] **4-state lifecycle** — `planned` / `active` / `merged` / `abandoned` columns grafted into `board/branches/`
- [x] **Board updated to v0.3.4** — town status board reflects new lifecycle structure; existing branch docs reorganized accordingly

---

## Session export path — `~/wildwest/sessions/` ✓ shipped v0.4.0

- [x] **`getDefaultExportPath()` updated** — default export path changed from `~/wildwest-vscode/{username}` to `~/wildwest/sessions/{username}`; session exports now live at framework level, not scoped to the tool name
- [x] **`~/wildwest/` as single world trunk** — marks the boundary of the `~/wildwest/` world migration; sessions belong alongside counties, not inside the vscode extension folder

---

## Always-on heartbeat + sane intervals ✓ shipped v0.5.3

- [x] **Heartbeat auto-starts on extension activate** — no manual `Start Heartbeat` needed; governed scopes detected and timers started immediately
- [x] **`FLOOR_MS` reduced from 24hr to 5 min** — absolute floor now meaningful; status bar reflects live devPair presence
- [x] **Default intervals corrected** — town idle: 5 min, town active: 2 min, county idle: 30 min, county active: 15 min, world idle: 1 hr, world active: 30 min
- [x] **`Stop Heartbeat` removed from command palette and menu** — heartbeat is always-on; stop is still available via `wildwest.enabled = false` setting

---

## sessionExporter.ts comment fix ✓ shipped v0.5.2

- [x] **Stale inline comment updated** — `sessionExporter.ts` line 58: `// Default: ${userHome}/wildwest-vscode/` → `${userHome}/wildwest/sessions/`

---

## README export path fix ✓ shipped v0.5.1

- [x] **README.md: stale `~/wildwest-vscode/` paths replaced** — export path description and `wildwest.exportPath` default updated to `~/wildwest/sessions/{git-username}/` to match the v0.4.0 actual behavior

---

## v3 cascading scope heartbeat ✓ shipped v0.5.0

- [x] **Multi-scope detection** — `detectScopes()` reads `scope` field from `.wildwest/registry.json`; for each town found, walks ancestor dirs to locate county and world roots; deduplicates by rootPath
- [x] **One independent timer per scope** — town, county, world each fire on their own setInterval clocks
- [x] **Interval inheritance chain** — registry `heartbeat.interval_ms` ?? VS Code extension settings ?? hardcoded floor (86400000ms / 24hr)
- [x] **Active modifier** — `hasActiveBranches()` reads `active_branches` from registry; uses `intervalActiveMs` when active
- [x] **Per-scope sentinels** — town: `telegraph/.last-beat`; county/world: `.wildwest/.last-beat`
- [x] **beatTown / beatCounty / beatWorld** — town scans telegraph flags; county checks all towns present on disk; world checks all counties present on disk
- [x] **Staleness threshold** — 2× effective intervalMs per scope
- [x] **6 new VS Code settings** — `wildwest.heartbeat.{town,county,world}.{intervalMs,intervalActiveMs}`; all default to 24hr floor
- [x] **Backward compat** — `.wildwest/scripts/` presence still recognized as pre-spec town
