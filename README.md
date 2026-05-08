# Wild West — VSCode Extension

Governance framework for AI-assisted development. Tracks dyad activity, exports chat sessions, monitors heartbeat, and coordinates identities across the Wild West county model.

**Current version:** 0.31.25

---

## What's New

**v0.31.25** — Sessions scope filter: click "Scope: Territory / County / Town" button to cycle. Town = current workspace only; County = all projects under `path.dirname(workspace)`; Territory = all (previous default). `toggleSessionScope` command registered. Filter applied in `loadAndBucketSessions` before bucketing.

**v0.31.24** — Last 7 days bucket groups sessions by local calendar date (Thu May 7, Wed May 6 …). Each day is a collapsible node; expand to see sessions. Dispatch via `sessions:last7d:YYYY-MM-DD` sectionId. All timestamps are local timezone (`toLocaleTimeString`/`toLocaleDateString`).

**v0.31.23** — Sessions date buckets (Today/Yesterday/Last 7 days/Older) are now expandable: each shows individual session rows with `[tool] project  HH:MM  N↕` label, tool icon, and tooltip with full path + timestamps. `loadAndBucketSessions()` replaces inline loop; bucket items use `sectionId` dispatch.

**v0.31.22** — Fix `ClaudeCodeTransformer`: was parsing JSON as JSONL (file split by newlines), numeric timestamps not converted to ISO strings. Now: `parseRaw` does `JSON.parse(rawContent)` directly; `resolveTimestamp()` converts epoch ms; `creationDate`/`lastMessageDate` used as session-level fallbacks (same pattern as Copilot). Claude Code sessions now appear in index.

**v0.31.21** — Sessions section now shows per-tool breakdown (Copilot / Claude / Codex) below the date buckets. `countStagedSessions()` returns `byTool` counts; `sessionsChildren()` renders them as indented rows with robot icon.

**v0.31.20** — Codex transformer rewritten for actual JSONL schema: `event_msg` (type=`user_message`) → user turns; `response_item` (role=`assistant`) → assistant turns. Timestamp from top-level `timestamp` ISO field, falling back to `session_start`. Content extracted from `payload.message` (user) or `payload.content[].text` (assistant). `extractTextContent`/`extractParts` handle Codex `text` field instead of `content`.

**v0.31.19** — `raw/` is the SSOT. `PipelineAdapter.processRawSessions()` clears `lastProcessedMtime` cache when `staged/storage/index.json` is missing, forcing full reprocess of all raw files. Deleting `staged/storage/` is now a safe reset — next Export Now or poll tick fully rebuilds from raw.

**v0.31.18** — Codex transformer: `parseRaw()` extracts `session_meta.timestamp` as `session_start`. `transformTurns()` uses `msg['timestamp']` (ISO string) then `msg['create_time']` (seconds epoch) then falls back to `session_start` — so `rollout-YYYY-MM-DD*` sessions get their actual creation date instead of today. Metadata/system lines (type ≠ 'message') skipped.

**v0.31.17** — Poll cycle now runs `processRawSessions()` on idle ticks when `staged/storage/index.json` is missing (recovery mode). Handles the case where storage was deleted but no raw-file activity is detected, so the state-change gate doesn't block pipeline rebuild.

**v0.31.16** — `exportNow()` now calls `pipelineAdapter.processRawSessions()` after scanning providers. Export Now creates `staged/storage/` from scratch if deleted and fully populates the index in one shot.

**v0.31.15** — Fix session date buckets: replaced rolling 48h `age < 2 * dayMs` window with calendar-date boundaries (`todayMs`, `yesterdayMs`, `last7dMs`). "Yesterday" now correctly shows all sessions whose date falls on the previous calendar day regardless of current time.

**v0.31.14** — Sessions section in side panel now has a clickable **Sort: Created / Sort: Updated** toggle row. Default is `Created`. Click cycles between grouping by `created_at` (session start) or `last_turn_at` (most recent activity). Persists for the session lifetime. `wildwest.toggleSessionSortBy` command registered.

**v0.31.13** — Side panel session buckets now use `created_at` (session creation date) instead of `last_turn_at` for date grouping (today/yesterday/7d/older). Matches ChatGPT "sort by created" default. Falls back to `last_turn_at` if `created_at` absent.

**v0.31.12** — Copilot transformer: turn timestamps now fall back to `session.creationDate` / `session.lastMessageDate` (numeric epoch ms → ISO) when per-request timestamps are absent. Fixes all sessions showing today's date in the side panel. `resolveTimestamp()` helper handles number, string, or undefined.

**v0.31.11** — `packetWriter.applyPacketToStorage()` uses `packet.turns[last].timestamp` for `last_turn_at` / `created_at` instead of `packet.created_at` (export time).

**v0.31.10** — `SidePanelProvider.countStagedSessions()` migrated from `staged/*.json` mtime scan to `staged/storage/index.json` (`last_turn_at`). Legacy `batchConvertSessions()` calls in `exportNow()` and Batch Convert menu disabled. `staged/*.json` flat files have no active readers.

**v0.31.9** — `exportNow()` re-enabled: scans all providers (Copilot, Codex, Claude Code, Copilot Edits) → updates `raw/` → runs `batchConvertSessions()` to regenerate `staged/*.json` with `wwuid`. Background poll and startup batch convert remain disabled.

**v0.31.8** — Legacy `batchConvertSessions` calls disabled in `sessionExporter.ts` (startup scan, poll cycle, manual trigger). Staged flat-file export replaced by `sessionPipeline`. `TODO(v0.32)` markers left for cleanup.

**v0.31.7** — Unified `generateWwuid(type, ...parts)` replaces `generateWwsid()` and `generateDeviceId()`. Single `WW_NAMESPACE`; type baked into hash input for global uniqueness. `wwsid` field renamed to `wwuid` across all pipeline types (`SessionPacket`, `SessionRecord`, `IndexEntry`), `packetWriter`, `orchestrator`, `adapter`, `batchConverter`, `chatSessionConverter`. `wwuid` added to telegraph memo frontmatter in `TelegraphCommands` and `TelegraphInbox` (send, ack, reply). Deprecated shims kept for backward compat.

**v0.31.6** — Deep rename: `actor`→`identity` and `devPair`→`dyad` completed across all pipeline types, session records, staged JSON schema (`actors[i].identity`), MCP board output, test fixtures, and all comments. `getActor()`→`getAuthor()` in SessionExportPipeline (git username stored as `author`). `validateActorForScope()`→`validateIdentityForScope()` in HeartbeatMonitor. Zero `actor`/`devPair` symbol references remaining.

**v0.31.4** — Terminology aligned with AI dev community: `actor` → `identity`, `devPair` → `dyad`. Setting renamed to `wildwest.identity`. Format unchanged: `TM(RHk)` = Role(dyad).

**v0.31.3** — batchConverter: all staged JSON files now include a stable `wwsid` (UUIDv5) field for framework-grade session identity across all three providers (Copilot `cpt`, Claude Code `cld`, Codex CLI `ccx`).

**v0.31.2** — Side panel overhaul: Heartbeat, Actor, Sessions, and Utilities sections redesigned.
- **Heartbeat** now shows state icon, scope, town alias (from registry), and last beat timestamp
- **Actor** correctly parses `Role(devPair)` notation — shows `Role: TM` and `devPair: RHk` separately; `Edit actor…` item opens an input box to update the setting in place (`wildwest.setActor` command)
- **Sessions** shows watcher toggle + bucketed session counts (Today / Yesterday / Last 7 days / Older) read from `staged/`
- **Utilities** (new) consolidates maintenance actions: Export Now, Open Export Folder, Doctor, Validate Registry, Reset Session Consent, View Output Log, Settings
- Sections reordered: Heartbeat · Actor · Sessions · Utilities · Inbox · Outbox · History · Board · Receipts

**v0.31.1** — Sessions section in side panel + tooltip redesign: the Wild West side panel now has a **Sessions** section (watcher state toggle, Export Now, Batch Convert, Convert to Markdown, Generate Index, Open Export Folder — all clickable). Sections reordered: Heartbeat and Actor first, then Sessions, then telegraph sections. Status bar tooltip redesigned: live header (actor · scope), heartbeat state + relative last-beat time, compact watcher toggle, telegraph quick-actions (Send · Ack · Inbox · Solo), compact footer (Log · Settings). Session action links removed from tooltip (moved to side panel).

**v0.31.0** — Unified status bar item: the two status bar items (session watcher eye + heartbeat/actor dot) are merged into a single `$(eye) ● Actor · Scope` item. Click focuses the Wild West side panel. Rich tooltip covers all session + governance actions.** — Sessions section in side panel + tooltip redesign: the Wild West side panel now has a **Sessions** section (watcher state toggle, Export Now, Batch Convert, Convert to Markdown, Generate Index, Open Export Folder — all clickable). Sections reordered: Heartbeat and Actor first, then Sessions, then telegraph sections. Status bar tooltip redesigned: live header (actor · scope), heartbeat state + relative last-beat time, compact watcher toggle, telegraph quick-actions (Send · Ack · Inbox · Solo), compact footer (Log · Settings). Session action links removed from tooltip (moved to side panel).

**v0.31.0** — Unified status bar item: the two status bar items (session watcher eye + heartbeat/actor dot) are merged into a single `$(eye) ● Actor · Scope` item. Click focuses the Wild West side panel. Rich tooltip covers all session + governance actions.** — Cascading init commands: `wildwest.initCounty` and `wildwest.initTerritory` scaffold the same `.wildwest/` structure at county and territory scope — registry.json (correct scope field), telegraph dirs (inbox/outbox/history), `.claude/settings.json` (Claude Code hooks), CLAUDE.md template, and `.gitignore` update. County and territory windows now register the `ClaudeCodeAdapter` too; EADDRINUSE is handled silently via auto-retry (no toast). Shared helpers `generateHookConfig`, `writeClaudeSettings`, `updateGitignore`, `createTelegraphDirs` eliminate duplication. 15 new tests; 15 suites, 205 total.

**v0.29.3** — Scope-gate adapter + territory liveness: `ClaudeCodeAdapter` is now only registered in town-scope workspaces — county/territory windows no longer try to bind port 7379 or show port-conflict errors. `checkLiveness()` now falls through town → county → territory so territory-level windows show a real heartbeat state instead of always `stopped`.

**v0.29.2** — Side panel heartbeat fix: `readSentinelTimestamp()` now reads the correct sentinel path per scope — `.wildwest/telegraph/.last-beat` for town, `.wildwest/.last-beat` for county/territory. County-level windows were showing a stale town sentinel (or `—`) instead of the current county beat.

**v0.29.1** — ClaudeCodeAdapter auto-retry + county liveness fix: adapter now retries every 30 s on EADDRINUSE so recovery is automatic when the holding window closes (warning toast shown once only). `checkLiveness()` falls back to county sentinel when no town scope is present, so county-level windows show correct alive/stopped state. New `wildwest.restartAdapter` command for manual recovery.

**v0.29.0** — Delivery receipts: new `DeliveryReceipts` module tracks status of all outbound memos — `pending` (in outbox), `failed` (!-prefixed), `delivered` (in outbox/history), `acknowledged` (ack-done received), `blocked` (ack-blocked received). Side panel Receipts section shows live status with icons (○ ✓ ✓✓ ✗ ⚠). `wildwest.showReceipts` QuickPick command opens any memo directly. 19 new tests; 15 suites, 190 total.

**v0.28.0** — Side panel: new activity bar icon (⭐) adds a persistent **Wild West** view with 6 collapsible sections — Inbox, Outbox, History, Board, Heartbeat, and Actor. Each section shows live file counts and file entries that open on click. Heartbeat section shows state/scope/last-beat; Actor section reads alias from registry and role from settings. Auto-refreshes every 10 s; manual refresh button in view title bar. `wildwest.refreshSidePanel` command. 11 new tests; 14 suites, 171 total.

**v0.27.0** — Memo action UX: `processInbox` now parses frontmatter to show `From: <actor> → <subject>` in the picker title instead of raw filename, previews first body line as picker detail, and adds a **Reply** action — compose and queue a full response memo to outbox (with correct frontmatter + `Ref:`) and archive the original in one step. Cancel on input box aborts without archiving. 9 new tests; 13 suites, 160 total.

**v0.26.0** — CLAUDE.md template: `wildwest.initTown` now generates a `CLAUDE.md` at the repo root (skips if already exists). Template includes identity block (alias, wwuid, remote, scope), cold-start checklist, key paths, telegraph rules, and quick commands — pre-filled from registry data. 9 new tests; 13 suites, 153 total.

**v0.25.13** — Privacy mode: new `wildwest.privacy.enabled` setting (default: off). When enabled, session export pipeline redacts secrets (GitHub tokens, AWS keys, Bearer tokens, sk- keys, env assignments), absolute paths, and home directory references from turn content before writing staged packets. 27 new tests; 12 suites, 144 total.

**v0.25.12** — Registry validator: new `wildwest.validateRegistry` command lints `.wildwest/registry.json` against the Wild West schema (required fields, UUID format, valid scope enum, actor shape, role-scope alignment). Output channel + notification summary. 26 new tests; 11 suites, 117 total.

**v0.25.11** — Release artifact hygiene: `build/*.vsix` files removed from git tracking. `.gitignore` updated to exclude all VSIX files; GitHub Releases workflow documented in `scripts/RELEASE.md`. Repo size reduced by ~8 MB.

**v0.25.10** — Production telegraph tests: replaced stub-based `telegraphDelivery.test.ts` with tests that drive the real `deliverPendingOutbox()` from `HeartbeatMonitor`; added `TelegraphService.test.ts` covering all 8 shared primitives. Test suite: 10 suites, 91 tests (was 9/71).

**v0.25.9** — TelegraphService abstraction: extracted shared telegraph primitives (`telegraphTimestamp`, `telegraphISOTimestamp`, `inboxPath`, `outboxPath`, `parseFrontmatter`, `archiveMemo`, `readRegistryAlias`, `getTelegraphDirs`) into `src/TelegraphService.ts`. Eliminated 6 duplicate implementations across `TelegraphCommands`, `TelegraphInbox`, and `WildwestParticipant`. No user-visible change.

**v0.25.8** — Wild West Doctor: new `wildwest.doctor` command validates the full local setup — registry fields, telegraph dirs, heartbeat freshness, export path, hook port 7379, MCP state, session consent, inbox memo count, and actor role. Results printed to the output channel with ✅/⚠️/❌ per check. Also available from the Wild West menu under Settings.

**v0.25.7** — First-run consent: session export now requires explicit user approval on first activation. A one-time dialog ("Allow" / "Not now") gates `SessionExporter.start()`. Consent stored in `globalState`; revoke via `Wild West: Reset Session Export Consent` command. Heartbeat and telegraph start regardless of consent.

**v0.25.6** — Self-addressed telegraph delivery fix: same-scope recipients now resolve to the current town path, so outbox memos addressed to the current town are delivered into the local inbox and archived through the normal delivery path. Added regression coverage for local inbox delivery.

**v0.25.5** — Telegraph and lifecycle fixes: `TelegraphInbox` now scans delivered v2 memos in `inbox/`, ack workflows queue outbound acks in `outbox/`, heartbeat no longer treats normal `inbox/`/`outbox/` directories as flags, the packet pipeline honors custom `wildwest.exportPath`, deactivation clears polling, heartbeat/status utility commands are contributed, and town/worktree git calls use argument arrays without switching the active checkout. Added production-focused `TelegraphInbox` tests.

**v0.25.4** — Test isolation: `batchConverter`, `chatSessionConverter`, and `jsonToMarkdown` test suites now use `os.tmpdir()` temp directories per test instead of a shared `__tests__/testdata/` path, eliminating intermittent failures from Jest parallel-runner conflicts.

**v0.25.3** — Lint cleanup: eliminated all 29 ESLint warnings. Removed unused imports (`getTransformer`, `Cursor`, `SessionIndex`, `parsePacketFilename`, `padSequence`, `TurnMeta`). Typed all `any` usages in pipeline code (`Record<string, unknown>`, `PartKind`, `TurnMeta`, `Cursor` casts). Added `argsIgnorePattern: ^_` to ESLint config so `_`-prefixed params are allowed.

**v0.25.2** — Fix `telegraphSend` hard-coded sender: `from:` field now reads alias from `.wildwest/registry.json` instead of hard-coding `TM(RHk).Cpt`. Falls back to `TM` if registry is unreadable.

**v0.25.1** — Resource leak fixes: `StatusBarManager` now stores and disposes config/workspace listeners and the refresh interval on deactivate. `BatchChatConverter.run()` throws instead of calling `process.exit(1)` — safe to call from the extension; CLI entry point still exits on error.

**v0.25.0** — Security fix: `git config user.name` now uses `execFileSync` with argument array instead of interpolated shell string, preventing command injection from user-supplied usernames.

**v0.24.0** — VSIX hygiene: `.vscodeignore` now excludes `src/`, `__tests__/`, `.wildwest/`, `docs/`, `scripts/`, `build/`, and all `tsc` output from `dist/` except `dist/extension.js` (the esbuild bundle). Package reduced from 311 → 3 files.

**v0.23.0** — `npm test` green: lint gate fixed (`no-explicit-any` → warn), `extractResponseAndThinking` handles `kind='text'` responses, deprecated-format detector regex corrected to `[A-Za-z]+` for multi-char abbreviations (e.g. `RSn`). 7/7 suites, 68/68 tests.

**v0.22.0** — P7 enhanced `@wildwest` participant: `send`, `ack`, `archive` with [Confirm] buttons; county+town inbox sweep; `telegraph check`; `status` shows open memo + branch counts. Operator fixes: delivered filename resolves wildcard alias; warn bare `from: TM` in multi-town county.

**v0.21.0** — P6 wwMCP server: read-only MCP server over stdio. Exposes `wildwest_status`, `wildwest_inbox`, `wildwest_board`, `wildwest_telegraph_check` tools. Disabled by default (`wildwest.mcp.enabled`). Actor-scoped, explicit opt-in, read-only.

**v0.20.1** — County outbox delivery fix: `beatTown()` and `deliverOutboxNow()` now walk parent directories to find and drain the county outbox on every heartbeat tick.

**v0.20.0** — `@wildwest` Copilot Chat participant: query telegraph inbox, board branches, and town status from the Copilot Chat panel.

**v0.19.0** — AIToolBridge + ClaudeCodeAdapter: HTTP hook receiver on `localhost:7379` for Claude Code stop/file-change events. `TownInit` now writes `.claude/settings.json` with hook config.

**v0.18.0** — Telegraph protocol v2: role-only addressing (e.g., `CD`), wildcard town routing (e.g., `TM(*vscode)`), county-wide delivery.

See: [Telegraph Addressing Protocol v0.18.0+](./docs/telegraph-addressing-v2.md)

---

## Features

### devPair Log Watcher
Automatically polls chat session storage every 5 seconds and exports raw sessions to `~/wildwest/sessions/{git-username}/raw/`:

| Provider | Source | Output folder |
|---|---|---|
| GitHub Copilot | VS Code global + workspace storage | `raw/github-copilot/` |
| Copilot Edits | `chatEditingSessions/` | `raw/copilot-edits/` |
| Codex CLI | `~/.codex/sessions/` | `raw/chatgpt-codex/` |
| Claude Code | `~/.claude/projects/` | `raw/claude-code/` |

### Batch Convert
Normalizes raw session JSON into a self-contained replay format under `staged/`. Run via the status bar tooltip or Command Palette.

### Markdown Conversion
Generates readable Markdown transcripts from staged JSON. Each session becomes a `.md` file with metadata header and full conversation.

### Session Index
Generates `INDEX.md` — a sorted index of all staged transcripts.

### Heartbeat Monitor
Writes periodic heartbeat beats to the `_heartbeat` worktree of the active repo. The worktree is a standard git worktree (`git worktree add ../_heartbeat _heartbeat`) and must exist before the monitor can run. Beat sentinel: `_heartbeat/.wildwest/telegraph/.last-beat`.

### Telegraph Watcher
Monitors `_heartbeat/.wildwest/telegraph/` in the active repo's `_heartbeat` worktree for inter-actor messages. Flags new messages in the status bar.

### Town Init
Onboards any repo into the Wild West governance model via a guided wizard (`wildwest.initTown`). Creates the `.wildwest/` directory structure, sets up the `_heartbeat` worktree, and updates `.gitignore`. Designed to be run once per repo.

---

## Status Bar

The **Wild West** status bar item (bottom right) shows watcher state, heartbeat, and actor/scope at a glance. Click to open the Wild West side panel.

**Tooltip provides:**
- Live status: actor · scope · heartbeat state · last beat (relative time)
- Watcher toggle (Start / Stop)
- Telegraph quick-actions: Send · Ack · View Inbox · Solo Report
- Footer: Output Log · Settings

**Side panel sections:**

| Section | Contents |
|---|---|
| Heartbeat | State, scope, town alias, last beat |
| Actor | Role, devPair, Edit actor… |
| Sessions | Watcher toggle, Today/Yesterday/Last 7d/Older counts |
| Utilities | Export Now, Open Export Folder, Doctor, Validate Registry, Reset Consent, Log, Settings |
| Inbox | Incoming telegraph memos |
| Outbox | Queued outbound memos |
| History | Delivered/archived memos |
| Board | Branch lifecycle docs |
| Receipts | Delivery receipt status |

---

## Commands

All commands are available via `Cmd+Shift+P` → `Wild West: ...`

| Command | Description |
|---|---|
| Start Watcher | Begin polling chat sessions |
| Stop Watcher | Stop polling |
| Export devPair Log Now | Manual export of all current sessions |
| Batch Convert All Sessions | Normalize raw → staged |
| Convert Exports to Markdown | Generate transcripts from staged JSON |
| Generate Index | Create INDEX.md for staged transcripts |
| Init Town | Initialize `.wildwest/` governance structure in the current repo |
| Start Heartbeat | Start heartbeat monitor |
| Stop Heartbeat | Stop heartbeat monitor |
| View Telegraph | Open `_heartbeat/.wildwest/telegraph/` in Finder |
| Solo Mode Report | Show solo mode activity report |

---

## Configuration

Settings are available under `Preferences → Settings → Wild West`.

| Setting | Default | Description |
|---|---|---|
| `wildwest.enabled` | `true` | Enable Wild West on startup |
| `wildwest.exportPath` | `~/wildwest/sessions/{git-username}/` | Export directory. Supports `~` and `${userHome}` |
| `wildwest.watchInterval` | `5000` | Poll interval in milliseconds |
| `wildwest.autoExportOnChange` | `true` | Auto-export when chat data changes |
| `wildwest.heartbeatInterval` | `300000` | Heartbeat interval in milliseconds (default: 5 min) |
| `wildwest.mcp.enabled` | `false` | Enable the wwMCP server (read-only, stdio). Must be explicitly enabled. |
| `wildwest.worldRoot` | `~/wildwest` | World root directory |
| `wildwest.claudeCode.hookPort` | `7379` | Port for Claude Code HTTP hook receiver |

---

## Install

Download the latest `.vsix` from [Releases](https://github.com/wildwest-ai/wildwest-vscode/releases) and run:

```bash
code --install-extension wildwest-vscode-<version>.vsix
```

Then reload the VSCode window (`Cmd+Shift+P` → **Developer: Reload Window**).

---

## Requirements

- VS Code `^1.90.0`
- Git configured with `user.name` (used to organize export folders)

---

## Known Limitations

### Copilot Response Text: Now Fully Captured + Thinking Preserved

GitHub Copilot chat storage now **fully captures** both response text and thinking in staged JSON:

- **Response text:** Extracted from parts where `kind` is undefined or null (the actual response shown to user)
- **Thinking:** Extracted from `kind='thinking'` parts (model's internal chain-of-thought); sentinels excluded

Both fields are preserved separately in the staged output, allowing full session review and model assessment.

### Empty Session Artifacts

VSCode creates session JSON stubs (480 bytes) when the chat panel opens, even if no messages are sent. These sessions have `requests: []` and `totalPrompts: 0`. The batch converter filters these automatically and does not write them to `staged/`.

---

## Roadmap

### MCP integration (P6 — v0.21.0 ✅)

`wwMCP` exposes Wild West governance state as a read-only MCP server over stdio. Enable with `wildwest.mcp.enabled = true`. Tools: `wildwest_status`, `wildwest_inbox`, `wildwest_board`, `wildwest_telegraph_check`. Access is explicit opt-in; scope is determined at connection time. Write authority deferred to v1.0+.

### `@wildwest` chat participant enhancements (P7 — v0.22.0 ✅)

Action-capable `@wildwest` with send/ack/archive workflows, county+town inbox sweep, and telegraph check — all routed through registered `wildwest.*` commands.
