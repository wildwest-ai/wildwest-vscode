# Changelog

## [Unreleased]

<!-- Write your What's New entry here before running release.sh -->

## [0.39.2] - 2026-05-11

Fixed 3 Telegraph Panel bugs: (1) Inbox "New" tab correctly filters `status: sent` wires — chip was matching `received`, causing the tab to appear empty after navigation. (2) Archive button now works — overlay fields (`recipient_archived_at`/`sender_archived_at`) are merged from local flat/ onto the territory wire on read; `isArchivedForActor()` drives the Archived chip and hides the Archive/Reply buttons once dismissed. (3) Reply button now shows for all inbox wires — was gated on `status: received/delivered/read` but inbox wires have `status: sent`.

## v0.39.1

Telegraph Panel bug fix attempt: (1) statusFilter now persists per tab via `tabStatusFilters` map and initializes to the first chip's status for each tab. (2) `handleArchiveWire` error logging improved — added `console.error` for missing dirs and wire-not-found cases. (3) Reply button added for inbox wires with status `received`, `delivered`, or `read`; `handleReply()` pre-fills compose drawer with sender address and `re:` subject.

## v0.39.0

Telegraph Panel bug fixes: (1) Fixed New tab wire disappearing on tab navigation — statusFilter now persists per tab and initializes to first chip's status ('received') instead of 'sent'. (2) Fixed Archive button silent failures — added error logging to handleArchiveWire for debugging wire file path and permission issues. (3) Added Reply button for inbox wires — users can now compose replies to received/delivered/read wires with pre-filled sender address and "re:" subject prefix.

## v0.38.0

Wire lifecycle refactor: full `draft → pending → sent → received → read → archived` pipeline. Recipient heartbeat now writes `status: received` to territory SSOT (not local cache). New `WireStatus` type; new fields `sent_at`, `received_at`, `read_at`, `sender_archived_at`, `recipient_archived_at`. Archive is a per-actor local overlay — promotes to `archived` in territory only when both sender and recipient have archived. Mark Read button in detail pane sets `status: read` + `read_at` in territory. `createFlatWire()` defaults to `status: 'draft'`. Telegraph panel reads territory-first; local flat/ only surfaced for drafts/pending.

## v0.37.14

Bug fix: wire row badge now displays "New" instead of raw "sent" for inbox wires. HeartbeatMonitor now records a `sent` transition on arrival so recipient timeline shows full `draft → pending → sent` sequence.

## v0.37.13

Bug fix: Telegraph panel now merges territory flat/ and workspace-local flat/, with workspace-local taking precedence. Recipient (county) now sees "New" instead of "Read" for unread wires. Status changes (Mark as Read, Archive) propagate to both directories.

## v0.37.12

UI: Inbox tab now shows "Read" instead of "Delivered" for wires with `status: delivered`. Clearer recipient-side semantics — "New" means unread, "Read" means seen/acknowledged, "Archived" means dismissed.

## v0.37.11

Bug fix: heartbeat now always writes `status: "sent"` at destination scope (previously wrote `status: "pending"` when wire arrived from outbox before sender-side promotion). Recipient inbox now consistently shows "New". Also: draft wire creation guide corrected — territory `~/wildwest/telegraph/flat/` (not town-local), and `from` must be `Role(alias)` format.

## v0.37.10

Documentation: Release runbook clarified — Step 2 (Update README) explicitly occurs BEFORE Step 3 (Run release script). Removed ambiguity about when to add What's New entries vs. update version number line.

## v0.37.9

Bug fix: wire status now correctly shows as "New" at recipient scope (not "Delivered"). Heartbeat no longer sets status to "delivered" when syncing to destination flat/. Wires show as "New" in recipient inbox until read/acted upon; "Delivered" only in sender outbox.

## v0.37.8

Bug fix: heartbeat now reconciles wires to destination scope SSOT. When delivering from town outbox to county inbox, heartbeat also creates the wire in county's `flat/` directory (SSOT). Fixes: wires invisible at destination scope in Telegraph panel because they only existed in legacy `inbox/` directory.

## v0.37.6

Bug fix: added heartbeat debug logging and fixed TM→CD county delivery routing so pending outbox wires are correctly resolved and delivered to the parent county inbox.

## v0.37.1

Draft detail pane: Send button (draft only) sets status → `pending` in flat/ and writes wire to workspace `outbox/` for heartbeat operator pickup. Archive button hidden when already archived.

## v0.37.0

Telegraph Panel: bulk status change — individual checkboxes per wire row, select-all, status dropdown (Draft/Pending/Sent/Delivered/Archived), Apply writes all selected wires to flat/ SSOT. Inbox chips: New | Delivered | Archived | All (New default). Outbox chips: Draft | Pending | Sent | Delivered | Archived | All. New statuses: `draft` (AI-prepared, awaiting author send) and `pending` (in outbox, awaiting operator pickup).

## v0.36.10

Address matching stripped of legacy `(dyad)[alias]` handling — migration script normalizes flat/ data; extension expects canonical format only. No behavior change post-migration.

## v0.36.9

Telegraph Panel: address matching rewritten — exact address parsing replacing loose `includes()`. Archive writes `status:archived` to flat/ JSON. Wire wwuid shown in list (8 chars) and detail (full). Archive button in detail pane.

## v0.36.8

Telegraph Panel inbox filter: status chip relabeled "New" (inbox) / "Sent" (outbox) — wires with `status:sent` in your inbox are new/unread. Match terms narrowed to alias + full identity only (no role-prefix wildcard) — town inbox no longer floods with cross-town TM wires.

## v0.36.7

Telegraph Panel: status filter bar (All / Sent / Delivered / Archived) on Inbox and Outbox tabs; wires grouped by scope (Town / County / Territory) based on role prefix in `to`/`from` address. Scope determination: `RA`/`G` → Territory, `CD`/`S`/`aCD`/`M` → County, all others → Town.

## v0.36.6

Telegraph Panel inbox/outbox filter now matches on both registry alias and `wildwest.identity` role (e.g. `CD(RSn)`) — county windows with role-based `to:` addressing now see their wires. `@wildwest send` and `@wildwest ack` both updated to use `WireFactory` (`createFlatWire` + `writeFlatWire`); wire preview shows JSON; wires drop to flat/ primary + outbox secondary.

## v0.36.5

`WireFactory.ts`: canonical schema v2 wire factory (`createFlatWire`, `writeFlatWire`, `parseFilenameActors`). Telegraph Panel Compose now writes directly to `~/wildwest/telegraph/flat/` (territory SSOT) as primary path, with workspace outbox as secondary for inbox delivery. `WireStorageService` removed from panel — no longer staging compose wires locally.

## v0.36.4

Telegraph Panel now reads from `~/wildwest/telegraph/flat/` (territory SSOT — 231 wires). Three tabs: Inbox (wires addressed to current actor), Outbox (wires from current actor), All (full archive with search). Detail view shows type, `delivered_at`, `re` reply chain, and `status_transitions` timeline. Status badges: sent/delivered/archived. Compose still writes to workspace outbox for heartbeat delivery.

## v0.36.3

Rename: all `memo`/`Memo` terminology updated to `wire`/`Wire` throughout the codebase — `MemoStorageService` → `WireStorageService`, `Memo` interface → `Wire`, `MemoStatus` → `WireStatus`, webview selectors, user-facing strings, MCP descriptions, and `wwuid_type: 'memo'` → `'wire'`. No behavior change.

## v0.36.1

Rename: all `memo`/`Memo` terminology updated to `wire`/`Wire` throughout — `MemoStorageService` → `WireStorageService`, `Memo` interface → `Wire`, `MemoStatus` → `WireStatus`, `listMemos` → `listWires`, webview selectors, user-facing strings, MCP descriptions, and `wwuid_type: 'memo'` → `'wire'`. No behavior change.

## v0.36.0

Prompt index suggestions are now context-sensitive: predictive entries are schema v3 with prompt kind, reusable score, scope lineage, framework compliance flags, and stricter scoped search. Completion and telegraph prompt suggestions suppress terminal output, bare continuation commands, and authorization snippets; `@wildwest prompts` now reports kind and framework flag breakdowns. Tests updated for registry v3 `identities`, current side-panel roots, and additive multi-workspace CPT attribution.

## v0.35.2

Prompt raw.json is now incremental: if raw.json exists, only sessions with `last_turn_at` newer than `raw.json.updated_at` are scanned and merged in (new prompts prepended, existing ids skipped). Full scan only on first run. index.json always rebuilt from full raw.json.

## v0.35.1

Prompt index two-stage pipeline: raw scan → `raw.json` (6,871 entries), then dedup + noise filter + score → `index.json` (4,871 unique). Score = 50% frequency + 35% recency + 15% length. Noise filters: `<tag>`, continuation headers, compaction notices, `[Request interrupted]`, tool output headers. MIN_CHAR raised to 20. Schema v2 adds `frequency`, `score`, `last_used`, `first_used`, `occurrences` per entry.

## v0.35.0

Prompt index: scans all session turns and builds `sessions/reneyap/prompts/index.json` (6,869 prompts across cld/cpt/ccx, tagged by tool + recorder_scope + scope_alias). IntelliSense surfaces: "Regenerate Prompts" in wwSidebar Utilities (shows count); `@wildwest prompts` for analytics + search (supports `scope:<alias>` filter); prompt autocomplete dropdown in Telegraph compose drawer body field; VSCode completion provider for `.md` files. Throttled auto-rebuild on pipeline activity.

## v0.34.2

Fix `last_turn_at` staying stale on continued CPT sessions: `normalizeCopilotSession` now uses `max(existing, inferred)` for `lastMessageDate` (Copilot sets it at creation and never updates via patches); `packetWriter` now uses `max(turn.timestamp)` across packet turns instead of last turn's timestamp. Sort: Updated in the sidebar now correctly moves continued sessions to Today.

## v0.34.1

Fix CPT `.jsonl` session parsing: handle both `kind=0` envelope and direct session object at root; add `kind=None` text fragment capture. Prevents empty session export for new Copilot `.jsonl` format.

## v0.34.0

Telegraph Panel: `wildwest.openTelegraphPanel` opens a webview panel with inbox/outbox list, rendered memo view, compose drawer (To/Type/Subject/Body → Send), and push buttons [→ Copilot] [→ Claude] [→ Codex] that inject formatted memo content into the target chat input.

## v0.33.0

Telegraph memos converted to JSON. `TelegraphCommands` writes `.json` to outbox and persists to `staged/storage/memos/<wwuid>.json` via new `MemoStorageService`. `TelegraphWatcher`, `SidePanelProvider`, and `wwMCPTools` all accept `.json` and `.md` (transition support). Ack flow reads JSON-native memos; legacy `.md` inboxes still handled.

## v0.32.12

Sidebar: Sessions Watcher moved to root level (below Heartbeat); tool rows (Copilot, Claude, Codex) are now expandable to show sessions for that tool.

## v0.32.10

Fix CCX model capture: model is in `turn_context` lines (not `session_meta`). Corrects v0.32.8 which always wrote `undefined` for Codex sessions.

## v0.32.9

Session preview: show model beside tool name in each assistant turn heading (e.g. `### GitHub Copilot  ·  \`claude-haiku-4-5-20251001\``).

## v0.32.8

Session pipeline: capture model per turn for all tools. CPT uses `result.metadata.resolvedModel`; CCX uses `turn_context.model`; CLD already captured. Session preview header shows **Model** row when available.

## v0.32.7

Session preview: turn headings use `### User` and `### ${toolName}` (e.g. `### GitHub Copilot`) instead of Human/Assistant.

## v0.32.6

Session preview: show thinking turns inline as `> 💭 ...` blockquotes within the assistant block.

## v0.32.5

Session preview: fix spurious blank code blocks and mid-sentence paragraph breaks in CPT sessions. Lone `` ``` `` streaming artifacts filtered; `\n\n` separator only injected between fragments with a thinking turn between them.

## v0.32.4

Session preview fragment merging fix: add `\n\n` between consecutive assistant fragments.

## v0.32.3

Session preview: fix blank assistant turns in CPT sessions. Falls back to `parts[kind=text]` when `content` is empty; skips pure thinking-only turns; merges consecutive assistant fragments into one block.

## v0.32.1

Session preview now opens as rendered markdown (via `markdown.showPreview`) instead of plain text.

## v0.32.0

Session preview: clicking a session in the sidebar now opens a read-only markdown view instead of raw JSON. Registry schema v3: `actors` renamed to `identities`, entries use `{ role, dyad }` (`channel` dropped); auto-migrated on heartbeat. Board cleanup: merged branches archived.

## v0.31.79

Fix town filter for CLD/CCX sessions. `recorder_wwuid` match is now sufficient for `cld`/`ccx` tools (project_path is ground-truth attribution). The `commit_count`/`signal_count` signal gate now only applies to `cpt`, where multiple open workspaces can share the same recorder. Adds 6 CLD/CCX wildwest-vscode sessions previously excluded due to missing signal data.

## v0.31.77

Tighten town filter: require `recorder_wwuid === town_wwuid` as a gate. Commits to a town's repo during a session window are strong evidence, but only when the session was actually recorded from that town. Eliminates wildwest-framework and other parallel-town false positives where commits happened in a separate terminal.

## v0.31.76

Add `GitCommitMatcher`: counts git commits to each town's repo during the session window and stores `commit_count` on `ScopeRef`. Town filter now uses `commit_count > 0` as the primary attribution signal (definitive proof of work), with `signal_count > 0` as fallback for sessions pre-dating this change. Eliminates false positives from multi-workspace sessions that only reference a town's files incidentally.

## v0.31.75

Add `exclude_scope_refs` to session-map schema. Allows explicit negation of auto-attributed or seeded scope_refs for sessions falsely claimed by a town. Exclusions are applied after injection during Rebuild, overriding seeded inject entries.

## v0.31.74

Tighten town scope filter: county/territory recorded sessions are excluded from town views even if they incidentally referenced town files. Null signal_count (no raw evidence) is also rejected. Town-level sessions with any raw signal (sc > 0) are shown.

## v0.31.72

Refine town scope filter: any raw signal_count > 0 means the session belongs to this town (multi-workspace sessions show in all active towns). Editorial overrides (null signal_count from session-map) only apply when no other town has raw signals, preventing false positives from overly-seeded overrides.

## v0.31.71

Fix town sidebar filter rejecting session-map editorial overrides. Session-map injected refs have `signal_count: null` (no raw signal data). The primary-signal rank check now treats `null` as an explicit editorial attribution and accepts it unconditionally — so seeded sessions show in the correct town's Older bucket.

## v0.31.70

Fix town sidebar over-matching. Town scope filter now only shows sessions where this town is the **primary** attribution (highest `signal_count` among all town `scope_refs`). Fixes Older showing sessions that merely mention the town as a secondary workspace but belong to another town.

## v0.31.69

Add `SessionMapService` + `SessionMapSeeder` for editorial session attribution overrides. `.wildwest/session-map.json` files inject `scope_refs` for sessions that predate automatic attribution (stale paths, pre-migration). New sidebar Utilities button: **Seed Session Map** — uses git log temporal matching + content path signals to backfill historical sessions. Seed before Rebuild Index to apply overrides.

## v0.31.68

Fix CPT session attribution for multi-workspace sessions. `resolveAttribution` now collects `scope_refs` for ALL workspaces with signals (not just the primary winner). Secondary towns that lose the attribution battle are now included in `scope_refs`, so town/county sidebar filters find them.

## v0.31.67

Remove legacy path-based session scope filter. Town and county views no longer fall back to `project_path` prefix matching for sessions missing `scope_refs`/`recorder_wwuid`; those unattributed records return false. Eliminates false 0-count for Older bucket after a clean sessions/ rebuild.

## v0.31.66

Fix false town/county session membership from cross-workspace Copilot references. Scoped records now filter only by exact `scope_refs`/`recorder_scope`; `workspace_wwuids` is used only for legacy records without scoped attribution. CPT rebuild now writes only the primary scope lineage and replaces stale `scope_refs` instead of merging old secondary town refs.

## v0.31.65

Session sidebar scope filtering now uses staged absolute scope metadata. Session records and index entries store `recorder_scope` plus `scope_refs[]` (`scope`, `wwuid`, `alias`, `path`, optional signal count), so town/county views filter by exact registry identity instead of path guesses. County view includes all member towns by scanning each town's `.wildwest/registry.json` as the SSOT.

## v0.31.64

Multi-workspace session support: add `workspace_wwuids[]` to index entries. Cross-workspace Copilot sessions now appear in every town panel where they have ≥3 signals — primary attribution (most signals) still set as `recorder_wwuid`/`project_path`. Side panel filter checks `workspace_wwuids` membership first.

## v0.31.63

Attribution is now fully window-agnostic. `resolveAttribution()` replaces all window-context inference: for `cld`/`ccx` reads `project_path` from raw file then looks up that path's `.wildwest/registry.json` for `recorder_wwuid`; for `cpt` counts all cwd/contentRef signals per workspace root, picks the workspace with the most hits. Same result from any window.

## v0.31.62

Fix cross-window attribution: when a session has no new turns but the current window can claim it (empty `recorder_wwuid` + `project_path`), patch the existing record in place.

## v0.31.61

Session row: show registry alias instead of `(unknown)` when `project_path` is empty but session matched via `recorder_wwuid`.

## v0.31.60

Fix `recorder_wwuid` over-stamping: only stamp when `resolvedProjectPath === this.projectPath`. Sessions belonging to other workspaces get empty `recorder_wwuid` and fall back to `project_path` filtering.

## v0.31.59

Fix: `staged/` not recreated after manual sessions/ delete. `PacketWriter` called `ensureDirectories()` only at construction time; directories gone after delete caused silent write failures. Now called before every packet and storage write.

## v0.31.58

Session attribution now anchored to `recorder_wwuid` (the recording town's `.wildwest/registry.json` wwuid) instead of fragile `project_path` inference. The side panel filters by `recorder_wwuid` for town scope — unambiguous, set at export time, unaffected by multi-workspace Copilot sessions. `rebuildIndex` stamps missing `recorder_wwuid` on existing records (migration).

## v0.31.56

Fix `toolSpecificData.cwd` extraction: VSCode URI dicts use `path` key (not always `fsPath`). Revert aggressive rebuildIndex re-attribution that stole sessions from other workspace windows.

## v0.31.54

Copilot workspace inference: also scan `response[].toolSpecificData.cwd` (in addition to `contentReferences`) to attribute Copilot sessions. Fixes older sessions that used tool invocations (e.g. terminal commands) as the only workspace evidence. Applies to both live pipeline and `rebuildIndex`.

## v0.31.53

Fix Copilot sessions missing from town panel. v0.31.51 removed the `project_path` fallback entirely, leaving all `cpt` sessions with an empty path. Now the orchestrator infers `project_path` from `contentReferences` `fsPath` values — if any referenced file lives in the current workspace, the session is attributed to it.

## v0.31.51

Session pipeline: fix three `CopilotTransformer` bugs: (1) response content extraction now correctly reads array-format responses and user messages; (2) `project_path` no longer falls back to active workspace for sessions with no `workspaceFolder` in raw data — false attributions eliminated; (3) `created_at` now uses `session.creationDate` instead of first-turn timestamp.

## v0.31.50

Sessions: click any session row to open its JSON file (`staged/storage/sessions/<wwuid>.json`) in the editor.

## v0.31.49

Town-scope filter: remove alias-basename fallback — only exact `project_path` match passes.

## v0.31.48

Sessions › Older: grouped by month (This month / Last month / Month YYYY), each collapsible. Items within a month show `MMM D` date prefix. Town-scope filter: ancestor-match removed from both session list and tool counter.

## v0.31.47

Sessions: town-scope filter no longer includes ancestor paths (world/county root sessions no longer bleed into town's Recent/Today list).

## v0.31.46

Sidebar heartbeat item: when flagged, tooltip shows unprocessed inbox memo subjects (same as status bar tooltip).

## v0.31.45

Status bar tooltip: when heartbeat is flagged, lists unprocessed inbox memos by subject (up to 5, with overflow count). Subject extracted by stripping timestamp prefix.

## v0.31.44

Status bar: add dedicated identity item (`$(person) TM(RHk)`) at priority 99, right of the main heartbeat item. Click it to edit identity directly. Shows warning color when unset.

## v0.31.43

Identity row: restore click-to-edit (input box). contextValue='identity' kept for view/item/inline pencil.

## v0.31.41

Identity row: inline edit button (pencil icon) appears on hover in the sidebar. Click the row or the pencil to open the input box. Uses `view/item/inline` menu contribution with `contextValue = 'identity'`.

## v0.31.40

Heartbeat item shows relative time instead of ISO timestamp: `10s ago`, `3m ago`, `2h ago`, `1d ago`. Full ISO timestamp still available in tooltip.

## v0.31.38

Sidebar root redesign: Heartbeat, Scope, and Identity are now flat inline items at the root (no collapsible nodes). Heartbeat shows `● alive  Last beat: HH:MM` with pulse icon. Scope shows `town  [alias]` with home icon. Identity shows role/dyad inline, click to edit via Command Palette.

## v0.31.37

Session buckets (Today/Yesterday/Last 7 days/Older) now show total turn count in parens: `Today   1 (30)`. Turn sums computed from `turn_count` field per session.

## v0.31.36

Recent node: add per-tool breakdown rows (Copilot/Claude/Codex) as children, showing only sessions in the recent 8-day window.

## v0.31.35

Recent becomes a collapsible parent node; Today/Yesterday/Last 7 days are its children. Older stays at top level.

## v0.31.34

Sessions section: rename `Total` row to `Recent  N  /  All  N` — shows recent (last 8 days) and all-time counts side by side. Tooltip shows per-bucket breakdown.

## v0.31.33

Sessions section: add `Total` stat row showing today + yesterday + last 7 days combined (recent window). Tooltip shows per-bucket breakdown.

## v0.31.32

Cascading governance scope filter: town scope now shows direct-match sessions AND ancestor-match sessions (project_path is a parent of the workspace). Governance is recursive — world/county sessions cascade down to constituent towns.

## v0.31.30

Fix ccx `tool_sid` double-extension bug: adapter was stripping `.json` from `.jsonl` filenames, leaving `tool_sid` as `rollout-...cb7.jsonl`. Now strips the correct extension per file type. `rebuildIndexFromRecords()` handles legacy records with `.jsonl`-suffixed tool_sid.

## v0.31.29

Add `wildwest.rebuildIndex` command + Utilities button. Scans `staged/storage/sessions/*.json`, patches ccx `project_path` from raw `session_meta.payload.cwd`, writes fresh `index.json`. Also runs automatically when `index.json` is missing.

## v0.31.28

Fix `CodexTransformer.getSessionMetadata()`: was returning `project_path: ''` for all sessions. Now extracts `session_meta.payload.cwd` in `parseRaw()` and surfaces it via `getSessionMetadata()`.

## v0.31.27

Town scope filter now matches by `alias` (`path.basename`) instead of full `project_path`. Fixes sessions missing when workspace was reorganized/moved. Convention: `alias === basename(project_path)` is stable across moves.

## v0.31.26

Sessions scope filter is now driven by `.wildwest/registry.json` (`scope` field), not a toggle. Town: exact workspace match. County: workspace IS county root — matches all towns within it. Territory (default): no filter.

## v0.31.25

Sessions scope filter: click "Scope: Territory / County / Town" button to cycle. Town = current workspace only; County = all projects under `path.dirname(workspace)`; Territory = all (previous default).

## v0.31.24

Last 7 days bucket groups sessions by local calendar date (Thu May 7, Wed May 6 …). Each day is a collapsible node; expand to see sessions.

## v0.31.23

Sessions date buckets (Today/Yesterday/Last 7 days/Older) are now expandable: each shows individual session rows with `[tool] project  HH:MM  N↕` label, tool icon, and tooltip with full path + timestamps.

## v0.31.22

Fix `ClaudeCodeTransformer`: was parsing JSON as JSONL (file split by newlines), numeric timestamps not converted to ISO strings. Now: `parseRaw` does `JSON.parse(rawContent)` directly; `resolveTimestamp()` converts epoch ms. Claude Code sessions now appear in index.

## v0.31.21

Sessions section now shows per-tool breakdown (Copilot / Claude / Codex) below the date buckets. `countStagedSessions()` returns `byTool` counts.

## v0.31.20

Codex transformer rewritten for actual JSONL schema: `event_msg` (type=`user_message`) → user turns; `response_item` (role=`assistant`) → assistant turns. Timestamp from top-level `timestamp` ISO field, falling back to `session_start`.

## v0.31.19

`raw/` is the SSOT. `PipelineAdapter.processRawSessions()` clears `lastProcessedMtime` cache when `staged/storage/index.json` is missing, forcing full reprocess of all raw files.

## v0.31.18

Codex transformer: `parseRaw()` extracts `session_meta.timestamp` as `session_start`. `transformTurns()` uses `msg['timestamp']` (ISO string) then `msg['create_time']` (seconds epoch) then falls back to `session_start`.

## v0.31.17

Poll cycle now runs `processRawSessions()` on idle ticks when `staged/storage/index.json` is missing (recovery mode).

## v0.31.16

`exportNow()` now calls `pipelineAdapter.processRawSessions()` after scanning providers. Export Now creates `staged/storage/` from scratch if deleted and fully populates the index in one shot.

## v0.31.15

Fix session date buckets: replaced rolling 48h window with calendar-date boundaries (`todayMs`, `yesterdayMs`, `last7dMs`). "Yesterday" now correctly shows all sessions whose date falls on the previous calendar day.

## v0.31.14

Sessions section in side panel now has a clickable **Sort: Created / Sort: Updated** toggle row. Click cycles between grouping by `created_at` (session start) or `last_turn_at` (most recent activity).

## v0.31.13

Side panel session buckets now use `created_at` (session creation date) instead of `last_turn_at` for date grouping. Matches ChatGPT "sort by created" default.

## v0.31.12

Copilot transformer: turn timestamps now fall back to `session.creationDate` / `session.lastMessageDate` (numeric epoch ms → ISO) when per-request timestamps are absent. Fixes all sessions showing today's date in the side panel.

## v0.31.11

`packetWriter.applyPacketToStorage()` uses `packet.turns[last].timestamp` for `last_turn_at` / `created_at` instead of `packet.created_at` (export time).

## v0.31.10

`SidePanelProvider.countStagedSessions()` migrated from `staged/*.json` mtime scan to `staged/storage/index.json` (`last_turn_at`). Legacy `batchConvertSessions()` calls in `exportNow()` and Batch Convert menu disabled.

## v0.31.9

`exportNow()` re-enabled: scans all providers (Copilot, Codex, Claude Code, Copilot Edits) → updates `raw/` → runs `batchConvertSessions()` to regenerate `staged/*.json` with `wwuid`.

## v0.31.8

Legacy `batchConvertSessions` calls disabled in `sessionExporter.ts` (startup scan, poll cycle, manual trigger). Staged flat-file export replaced by `sessionPipeline`.

## v0.31.7

Unified `generateWwuid(type, ...parts)` replaces `generateWwsid()` and `generateDeviceId()`. Single `WW_NAMESPACE`; type baked into hash input for global uniqueness. `wwsid` field renamed to `wwuid` across all pipeline types, `packetWriter`, `orchestrator`, `adapter`, `batchConverter`, `chatSessionConverter`. `wwuid` added to telegraph memo frontmatter.

## v0.31.6

Deep rename: `actor`→`identity` and `devPair`→`dyad` completed across all pipeline types, session records, staged JSON schema, MCP board output, test fixtures, and all comments.

## v0.31.4

Terminology aligned with AI dev community: `actor` → `identity`, `devPair` → `dyad`. Setting renamed to `wildwest.identity`. Format unchanged: `TM(RHk)` = Role(dyad).

## v0.31.3

batchConverter: all staged JSON files now include a stable `wwsid` (UUIDv5) field for framework-grade session identity across all three providers (Copilot `cpt`, Claude Code `cld`, Codex CLI `ccx`).

## v0.31.2

Side panel overhaul: Heartbeat, Actor, Sessions, and Utilities sections redesigned. Heartbeat now shows state icon, scope, town alias (from registry), and last beat timestamp. Actor correctly parses `Role(devPair)` notation. Sessions shows watcher toggle + bucketed session counts. Utilities consolidates maintenance actions.

## v0.31.1

Sessions section in side panel + tooltip redesign. Wild West side panel now has a **Sessions** section (watcher state toggle, Export Now, Batch Convert, Convert to Markdown, Generate Index, Open Export Folder — all clickable). Status bar tooltip redesigned: live header, heartbeat state, compact watcher toggle, telegraph quick-actions, compact footer.

## v0.31.0

Unified status bar item: the two status bar items (session watcher eye + heartbeat/actor dot) are merged into a single `$(eye) ● Actor · Scope` item. Click focuses the Wild West side panel. Rich tooltip covers all session + governance actions.

## v0.29.3

Scope-gate adapter + territory liveness: `ClaudeCodeAdapter` is now only registered in town-scope workspaces — county/territory windows no longer try to bind port 7379 or show port-conflict errors. `checkLiveness()` now falls through town → county → territory.

## v0.29.2

Side panel heartbeat fix: `readSentinelTimestamp()` now reads the correct sentinel path per scope — `.wildwest/telegraph/.last-beat` for town, `.wildwest/.last-beat` for county/territory.

## v0.29.1

ClaudeCodeAdapter auto-retry + county liveness fix: adapter now retries every 30 s on EADDRINUSE so recovery is automatic when the holding window closes. `checkLiveness()` falls back to county sentinel when no town scope is present.

## v0.29.0

Delivery receipts: new `DeliveryReceipts` module tracks status of all outbound memos — `pending`, `failed`, `delivered`, `acknowledged`, `blocked`. Side panel Receipts section shows live status with icons. `wildwest.showReceipts` QuickPick command opens any memo directly.

## v0.28.0

Side panel: new activity bar icon (⭐) adds a persistent **Wild West** view with 6 collapsible sections — Inbox, Outbox, History, Board, Heartbeat, and Actor. Auto-refreshes every 10 s; manual refresh button in view title bar.

## v0.27.0

Memo action UX: `processInbox` now parses frontmatter to show `From: <actor> → <subject>` in the picker title, previews first body line as picker detail, and adds a **Reply** action — compose and queue a full response memo to outbox (with correct frontmatter + `Ref:`) and archive the original in one step.

## v0.26.0

CLAUDE.md template: `wildwest.initTown` now generates a `CLAUDE.md` at the repo root (skips if already exists). Template includes identity block, cold-start checklist, key paths, telegraph rules, and quick commands — pre-filled from registry data.

## v0.25.13

Privacy mode: new `wildwest.privacy.enabled` setting (default: off). When enabled, session export pipeline redacts secrets (GitHub tokens, AWS keys, Bearer tokens, sk- keys, env assignments), absolute paths, and home directory references from turn content before writing staged packets.

## v0.25.12

Registry validator: new `wildwest.validateRegistry` command lints `.wildwest/registry.json` against the Wild West schema (required fields, UUID format, valid scope enum, actor shape, role-scope alignment).

## v0.25.11

Release artifact hygiene: `build/*.vsix` files removed from git tracking. `.gitignore` updated to exclude all VSIX files; GitHub Releases workflow documented in `scripts/RELEASE.md`.

## v0.25.10

Production telegraph tests: replaced stub-based `telegraphDelivery.test.ts` with tests that drive the real `deliverPendingOutbox()` from `HeartbeatMonitor`; added `TelegraphService.test.ts` covering all 8 shared primitives.

## v0.25.9

TelegraphService abstraction: extracted shared telegraph primitives into `src/TelegraphService.ts`. Eliminated 6 duplicate implementations across `TelegraphCommands`, `TelegraphInbox`, and `WildwestParticipant`.

## v0.25.8

Wild West Doctor: new `wildwest.doctor` command validates the full local setup — registry fields, telegraph dirs, heartbeat freshness, export path, hook port 7379, MCP state, session consent, inbox memo count, and actor role.

## v0.25.7

First-run consent: session export now requires explicit user approval on first activation. A one-time dialog ("Allow" / "Not now") gates `SessionExporter.start()`. Consent stored in `globalState`; revoke via `Wild West: Reset Session Export Consent` command.

## v0.25.6

Self-addressed telegraph delivery fix: same-scope recipients now resolve to the current town path, so outbox memos addressed to the current town are delivered into the local inbox and archived through the normal delivery path.

## v0.25.5

Telegraph and lifecycle fixes: `TelegraphInbox` now scans delivered v2 memos in `inbox/`, ack workflows queue outbound acks in `outbox/`, heartbeat no longer treats normal `inbox/`/`outbox/` directories as flags, the packet pipeline honors custom `wildwest.exportPath`, deactivation clears polling, heartbeat/status utility commands are contributed.

## v0.25.4

Test isolation: `batchConverter`, `chatSessionConverter`, and `jsonToMarkdown` test suites now use `os.tmpdir()` temp directories per test instead of a shared `__tests__/testdata/` path.

## v0.25.3

Lint cleanup: eliminated all 29 ESLint warnings. Removed unused imports. Typed all `any` usages in pipeline code. Added `argsIgnorePattern: ^_` to ESLint config.

## v0.25.2

Fix `telegraphSend` hard-coded sender: `from:` field now reads alias from `.wildwest/registry.json` instead of hard-coding `TM(RHk).Cpt`.

## v0.25.1

Resource leak fixes: `StatusBarManager` now stores and disposes config/workspace listeners and the refresh interval on deactivate. `BatchChatConverter.run()` throws instead of calling `process.exit(1)`.

## v0.25.0

Security fix: `git config user.name` now uses `execFileSync` with argument array instead of interpolated shell string, preventing command injection from user-supplied usernames.

## v0.24.0

VSIX hygiene: `.vscodeignore` now excludes `src/`, `__tests__/`, `.wildwest/`, `docs/`, `scripts/`, `build/`, and all `tsc` output from `dist/` except `dist/extension.js`. Package reduced from 311 → 3 files.

## v0.23.0

`npm test` green: lint gate fixed (`no-explicit-any` → warn), `extractResponseAndThinking` handles `kind='text'` responses, deprecated-format detector regex corrected. 7/7 suites, 68/68 tests.

## v0.22.0

P7 enhanced `@wildwest` participant: `send`, `ack`, `archive` with [Confirm] buttons; county+town inbox sweep; `telegraph check`; `status` shows open memo + branch counts. Operator fixes: delivered filename resolves wildcard alias; warn bare `from: TM` in multi-town county.

## v0.21.0

P6 wwMCP server: read-only MCP server over stdio. Exposes `wildwest_status`, `wildwest_inbox`, `wildwest_board`, `wildwest_telegraph_check` tools. Disabled by default (`wildwest.mcp.enabled`). Actor-scoped, explicit opt-in, read-only.

## v0.20.1

County outbox delivery fix: `beatTown()` and `deliverOutboxNow()` now walk parent directories to find and drain the county outbox on every heartbeat tick.

## v0.20.0

`@wildwest` Copilot Chat participant: query telegraph inbox, board branches, and town status from the Copilot Chat panel.

## v0.19.0

AIToolBridge + ClaudeCodeAdapter: HTTP hook receiver on `localhost:7379` for Claude Code stop/file-change events. `TownInit` now writes `.claude/settings.json` with hook config.

## v0.18.0

Telegraph protocol v2: role-only addressing (e.g., `CD`), wildcard town routing (e.g., `TM(*vscode)`), county-wide delivery.

See: [Telegraph Addressing Protocol v0.18.0+](./docs/telegraph-addressing-v2.md)
