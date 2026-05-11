# Wild West — VSCode Extension

Governance framework for AI-assisted development. Tracks dyad activity, exports chat sessions, monitors heartbeat, and coordinates identities across the Wild West county model.

**Current version:** v0.39.0

---

## What's New

**v0.39.0** — Telegraph Panel bug fixes: (1) Fixed New tab wire disappearing on tab navigation — statusFilter now persists per tab and initializes to first chip's status ('received') instead of 'sent'. (2) Fixed Archive button silent failures — added error logging to handleArchiveWire for debugging wire file path and permission issues. (3) Added Reply button for inbox wires — users can now compose replies to received/delivered/read wires with pre-filled sender address and "re:" subject prefix.

**v0.38.0** — Wire lifecycle refactor: full `draft → pending → sent → received → read → archived` pipeline. Recipient heartbeat now writes `status: received` to territory SSOT (not local cache). New `WireStatus` type; new fields `sent_at`, `received_at`, `read_at`, `sender_archived_at`, `recipient_archived_at`. Archive is a per-actor local overlay — promotes to `archived` in territory only when both sender and recipient have archived. Mark Read button in detail pane sets `status: read` + `read_at` in territory. `createFlatWire()` defaults to `status: 'draft'`. Telegraph panel reads territory-first; local flat/ only surfaced for drafts/pending.

**v0.37.14** — Bug fix: wire row badge now displays "New" instead of raw "sent" for inbox wires. HeartbeatMonitor now records a `sent` transition on arrival so recipient timeline shows full `draft → pending → sent` sequence.

**v0.37.13** — Bug fix: Telegraph panel now merges territory flat/ and workspace-local flat/, with workspace-local taking precedence. Recipient (county) now sees "New" instead of "Read" for unread wires. Status changes (Mark as Read, Archive) propagate to both directories.

**v0.37.12** — UI: Inbox tab now shows "Read" instead of "Delivered" for wires with `status: delivered`. Clearer recipient-side semantics — "New" means unread, "Read" means seen/acknowledged, "Archived" means dismissed.

**v0.37.11** — Bug fix: heartbeat now always writes `status: "sent"` at destination scope (previously wrote `status: "pending"` when wire arrived from outbox before sender-side promotion). Recipient inbox now consistently shows "New". Also: draft wire creation guide corrected — territory `~/wildwest/telegraph/flat/` (not town-local), and `from` must be `Role(alias)` format.

**v0.37.10** — Documentation: Release runbook clarified — Step 2 (Update README) explicitly occurs BEFORE Step 3 (Run release script). Removed ambiguity about when to add What's New entries vs. update version number line.

**v0.37.9** — Bug fix: wire status now correctly shows as "New" at recipient scope (not "Delivered"). Heartbeat no longer sets status to "delivered" when syncing to destination flat/. Wires show as "New" in recipient inbox until read/acted upon; "Delivered" only in sender outbox.

**v0.37.8** — Bug fix: heartbeat now reconciles wires to destination scope SSOT. When delivering from town outbox to county inbox, heartbeat also creates the wire in county's `flat/` directory (SSOT). Fixes: wires invisible at destination scope in Telegraph panel because they only existed in legacy `inbox/` directory.

**v0.37.6** — Bug fix: added heartbeat debug logging and fixed TM→CD county delivery routing so pending outbox wires are correctly resolved and delivered to the parent county inbox.

**v0.37.1** — Draft detail pane: Send button (draft only) sets status → `pending` in flat/ and writes wire to workspace `outbox/` for heartbeat operator pickup. Archive button hidden when already archived.

**v0.37.0** — Telegraph Panel: bulk status change — individual checkboxes per wire row, select-all, status dropdown (Draft/Pending/Sent/Delivered/Archived), Apply writes all selected wires to flat/ SSOT. Inbox chips: New | Delivered | Archived | All (New default). Outbox chips: Draft | Pending | Sent | Delivered | Archived | All. New statuses: `draft` (AI-prepared, awaiting author send) and `pending` (in outbox, awaiting operator pickup).

**v0.36.10** — Address matching stripped of legacy `(dyad)[alias]` handling — migration script normalizes flat/ data; extension expects canonical format only. No behavior change post-migration.

**v0.36.9** — Telegraph Panel: address matching rewritten — exact address parsing replacing loose `includes()`. Archive writes `status:archived` to flat/ JSON. Wire wwuid shown in list (8 chars) and detail (full). Archive button in detail pane.

**v0.36.8** — Telegraph Panel inbox filter: status chip relabeled "New" (inbox) / "Sent" (outbox) — wires with `status:sent` in your inbox are new/unread. Match terms narrowed to alias + full identity only (no role-prefix wildcard) — town inbox no longer floods with cross-town TM wires.

**v0.36.7** — Telegraph Panel: status filter bar (All / Sent / Delivered / Archived) on Inbox and Outbox tabs; wires grouped by scope (Town / County / Territory) based on role prefix in `to`/`from` address. Scope determination: `RA`/`G` → Territory, `CD`/`S`/`aCD`/`M` → County, all others → Town.

**v0.36.6** — Telegraph Panel inbox/outbox filter now matches on both registry alias and `wildwest.identity` role (e.g. `CD(RSn)`) — county windows with role-based `to:` addressing now see their wires. `@wildwest send` and `@wildwest ack` both updated to use `WireFactory` (`createFlatWire` + `writeFlatWire`); wire preview shows JSON; wires drop to flat/ primary + outbox secondary.

**v0.36.5** — `WireFactory.ts`: canonical schema v2 wire factory (`createFlatWire`, `writeFlatWire`, `parseFilenameActors`). Telegraph Panel Compose now writes directly to `~/wildwest/telegraph/flat/` (territory SSOT) as primary path, with workspace outbox as secondary for inbox delivery. `WireStorageService` removed from panel — no longer staging compose wires locally.

**v0.36.4** — Telegraph Panel now reads from `~/wildwest/telegraph/flat/` (territory SSOT — 231 wires). Three tabs: Inbox (wires addressed to current actor), Outbox (wires from current actor), All (full archive with search). Detail view shows type, `delivered_at`, `re` reply chain, and `status_transitions` timeline. Status badges: sent/delivered/archived. Compose still writes to workspace outbox for heartbeat delivery.

**v0.36.3** — Rename: all `memo`/`Memo` terminology updated to `wire`/`Wire` throughout the codebase — `MemoStorageService` → `WireStorageService`, `Memo` interface → `Wire`, `MemoStatus` → `WireStatus`, webview selectors, user-facing strings, MCP descriptions, and `wwuid_type: 'memo'` → `'wire'`. No behavior change.

**v0.36.1** — Rename: all `memo`/`Memo` terminology updated to `wire`/`Wire` throughout — `MemoStorageService` → `WireStorageService`, `Memo` interface → `Wire`, `MemoStatus` → `WireStatus`, `listMemos` → `listWires`, webview selectors, user-facing strings, MCP descriptions, and `wwuid_type: 'memo'` → `'wire'`. No behavior change.

**v0.36.0** — Prompt index suggestions are now context-sensitive: predictive entries are schema v3 with prompt kind, reusable score, scope lineage, framework compliance flags, and stricter scoped search. Completion and telegraph prompt suggestions suppress terminal output, bare continuation commands, and authorization snippets; `@wildwest prompts` now reports kind and framework flag breakdowns. Tests updated for registry v3 `identities`, current side-panel roots, and additive multi-workspace CPT attribution.

**v0.35.2** — Prompt raw.json is now incremental: if raw.json exists, only sessions with `last_turn_at` newer than `raw.json.updated_at` are scanned and merged in (new prompts prepended, existing ids skipped). Full scan only on first run. index.json always rebuilt from full raw.json.

**v0.35.1** — Prompt index two-stage pipeline: raw scan → `raw.json` (6,871 entries), then dedup + noise filter + score → `index.json` (4,871 unique). Score = 50% frequency + 35% recency + 15% length. Noise filters: `<tag>`, continuation headers, compaction notices, `[Request interrupted]`, tool output headers. MIN_CHAR raised to 20. Schema v2 adds `frequency`, `score`, `last_used`, `first_used`, `occurrences` per entry.

**v0.35.0** — Prompt index: scans all session turns and builds `sessions/reneyap/prompts/index.json` (6,869 prompts across cld/cpt/ccx, tagged by tool + recorder_scope + scope_alias). IntelliSense surfaces: "Regenerate Prompts" in wwSidebar Utilities (shows count); `@wildwest prompts` for analytics + search (supports `scope:<alias>` filter); prompt autocomplete dropdown in Telegraph compose drawer body field; VSCode completion provider for `.md` files. Throttled auto-rebuild on pipeline activity.

**v0.34.2** — Fix `last_turn_at` staying stale on continued CPT sessions: `normalizeCopilotSession` now uses `max(existing, inferred)` for `lastMessageDate` (Copilot sets it at creation and never updates via patches); `packetWriter` now uses `max(turn.timestamp)` across packet turns instead of last turn's timestamp. Sort: Updated in the sidebar now correctly moves continued sessions to Today.

**v0.34.1** — Fix CPT `.jsonl` session parsing: handle both `kind=0` envelope and direct session object at root; add `kind=None` text fragment capture. Prevents empty session export for new Copilot `.jsonl` format.

**v0.34.0** — Telegraph Panel: `wildwest.openTelegraphPanel` opens a webview panel with inbox/outbox list, rendered memo view, compose drawer (To/Type/Subject/Body → Send), and push buttons [→ Copilot] [→ Claude] [→ Codex] that inject formatted memo content into the target chat input.

**v0.33.0** — Telegraph memos converted to JSON. `TelegraphCommands` writes `.json` to outbox and persists to `staged/storage/memos/<wwuid>.json` via new `MemoStorageService`. `TelegraphWatcher`, `SidePanelProvider`, and `wwMCPTools` all accept `.json` and `.md` (transition support). Ack flow reads JSON-native memos; legacy `.md` inboxes still handled.

**v0.32.12** — Sidebar: Sessions Watcher moved to root level (below Heartbeat); tool rows (Copilot, Claude, Codex) are now expandable to show sessions for that tool.

**v0.32.11** — Sidebar: Sessions Watcher moved to root level (below Heartbeat); tool rows (Copilot, Claude, Codex) are now expandable to show sessions for that tool.

**v0.32.10** — Fix CCX model capture: model is in `turn_context` lines (not `session_meta`). Corrects v0.32.8 which always wrote `undefined` for Codex sessions.

**v0.32.9** — Session preview: show model beside tool name in each assistant turn heading (e.g. `### GitHub Copilot  ·  \`claude-haiku-4-5-20251001\``).

**v0.32.8** — Session pipeline: capture model per turn for all tools. CPT uses `result.metadata.resolvedModel`; CCX uses `turn_context.model`; CLD already captured. Session preview header shows **Model** row when available.

**v0.32.7** — Session preview: turn headings use `### User` and `### ${toolName}` (e.g. `### GitHub Copilot`) instead of Human/Assistant.

**v0.32.6** — Session preview: show thinking turns inline as `> 💭 ...` blockquotes within the assistant block.

**v0.32.5** — Session preview: fix spurious blank code blocks and mid-sentence paragraph breaks in CPT sessions. Lone `` ``` `` streaming artifacts filtered; `\n\n` separator only injected between fragments with a thinking turn between them.

**v0.32.4** — Session preview fragment merging fix: add `\n\n` between consecutive assistant fragments.

**v0.32.3** — Session preview: fix blank assistant turns in CPT sessions. Falls back to `parts[kind=text]` when `content` is empty; skips pure thinking-only turns; merges consecutive assistant fragments into one block.

**v0.32.1** — Session preview now opens as rendered markdown (via `markdown.showPreview`) instead of plain text.

**v0.32.0** — Session preview: clicking a session in the sidebar now opens a read-only markdown view instead of raw JSON. Registry schema v3: `actors` renamed to `identities`, entries use `{ role, dyad }` (`channel` dropped); auto-migrated on heartbeat. Board cleanup: merged branches archived.

**v0.31.79** — Fix town filter for CLD/CCX sessions. `recorder_wwuid` match is now sufficient for `cld`/`ccx` tools (project_path is ground-truth attribution). The `commit_count`/`signal_count` signal gate now only applies to `cpt`, where multiple open workspaces can share the same recorder. Adds 6 CLD/CCX wildwest-vscode sessions previously excluded due to missing signal data.

**v0.31.78** — (intermediate release, same fix as v0.31.79)

**v0.31.77** — Tighten town filter: require `recorder_wwuid === town_wwuid` as a gate. Commits to a town's repo during a session window are strong evidence, but only when the session was actually recorded from that town. Eliminates wildwest-framework and other parallel-town false positives where commits happened in a separate terminal.

**v0.31.76** — Add `GitCommitMatcher`: counts git commits to each town's repo during the session window and stores `commit_count` on `ScopeRef`. Town filter now uses `commit_count > 0` as the primary attribution signal (definitive proof of work), with `signal_count > 0` as fallback for sessions pre-dating this change. Eliminates false positives from multi-workspace sessions that only reference a town's files incidentally.

**v0.31.75** — Add `exclude_scope_refs` to session-map schema. Allows explicit negation of auto-attributed or seeded scope_refs for sessions falsely claimed by a town. Exclusions are applied after injection during Rebuild, overriding seeded inject entries. Added exclusion for `9c1cd171` (nx-icouponads primary with incidental wildwest-vscode signals).

**v0.31.74** — Tighten town scope filter: county/territory recorded sessions are excluded from town views even if they incidentally referenced town files. Null signal_count (no raw evidence) is also rejected. Town-level sessions with any raw signal (sc > 0) are shown.

**v0.31.72** — Refine town scope filter: any raw signal_count > 0 means the session belongs to this town (multi-workspace sessions show in all active towns). Editorial overrides (null signal_count from session-map) only apply when no other town has raw signals, preventing false positives from overly-seeded overrides.

**v0.31.71** — Fix town sidebar filter rejecting session-map editorial overrides. Session-map injected refs have `signal_count: null` (no raw signal data). The primary-signal rank check now treats `null` as an explicit editorial attribution and accepts it unconditionally — so seeded sessions show in the correct town's Older bucket.

**v0.31.70** — Fix town sidebar over-matching. Town scope filter now only shows sessions where this town is the **primary** attribution (highest `signal_count` among all town `scope_refs`). Fixes Older showing sessions that merely mention the town as a secondary workspace but belong to another town.

**v0.31.69** — Add `SessionMapService` + `SessionMapSeeder` for editorial session attribution overrides. `.wildwest/session-map.json` files inject `scope_refs` for sessions that predate automatic attribution (stale paths, pre-migration). New sidebar Utilities button: **Seed Session Map** — uses git log temporal matching + content path signals to backfill historical sessions. Seed before Rebuild Index to apply overrides.

**v0.31.68** — Fix CPT session attribution for multi-workspace sessions. `resolveAttribution` now collects `scope_refs` for ALL workspaces with signals (not just the primary winner). Secondary towns like `wildwest-vscode` (143 signals) that lose the attribution battle to another town (495 signals) are now included in `scope_refs`, so town/county sidebar filters find them. Run Rebuild Index after installing to backfill older sessions.

**v0.31.67** — Remove legacy path-based session scope filter. Town and county views no longer fall back to `project_path` prefix matching for sessions missing `scope_refs`/`recorder_wwuid`; those unattributed records return false. Eliminates false 0-count for Older bucket after a clean sessions/ rebuild.

**v0.31.66** — Fix false town/county session membership from cross-workspace Copilot references. Scoped records now filter only by exact `scope_refs`/`recorder_scope`; `workspace_wwuids` is used only for legacy records without scoped attribution. CPT rebuild now writes only the primary scope lineage and replaces stale `scope_refs` instead of merging old secondary town refs.

**v0.31.65** — Session sidebar scope filtering now uses staged absolute scope metadata. Session records and index entries store `recorder_scope` plus `scope_refs[]` (`scope`, `wwuid`, `alias`, `path`, optional signal count), so town/county views filter by exact registry identity instead of path guesses. County view includes all member towns by scanning each town's `.wildwest/registry.json` as the SSOT and supports legacy staged data as fallback.

**v0.31.64** — Multi-workspace session support: add `workspace_wwuids[]` to index entries. Cross-workspace Copilot sessions now appear in every town panel where they have ≥3 signals — primary attribution (most signals) still set as `recorder_wwuid`/`project_path`. Side panel filter checks `workspace_wwuids` membership first.

**v0.31.63** — Attribution is now fully window-agnostic. `resolveAttribution()` replaces all window-context inference: for `cld`/`ccx` reads `project_path` from raw file then looks up that path's `.wildwest/registry.json` for `recorder_wwuid`; for `cpt` counts all cwd/contentRef signals per workspace root (walking up to find `.wildwest/registry.json`), picks the workspace with the most hits. Same result from any window — no need to run Export Now from every town.

**v0.31.62** — Fix cross-window attribution: when a session has no new turns but the current window can claim it (empty `recorder_wwuid` + `project_path`), patch the existing record in place. Enables `wildwest-framework` window to claim its sessions even when the `wildwest-vscode` window wrote them first with empty attribution.

**v0.31.61** — Session row: show registry alias instead of `(unknown)` when `project_path` is empty but session matched via `recorder_wwuid`.

**v0.31.60** — Fix `recorder_wwuid` over-stamping: only stamp when `resolvedProjectPath === this.projectPath` (session is actually attributed to this workspace). Sessions belonging to other workspaces get empty `recorder_wwuid` and fall back to `project_path` filtering. Same constraint applied to `rebuildIndex` migration stamp.

**v0.31.59** — Fix: `staged/` not recreated after manual sessions/ delete. `PacketWriter` called `ensureDirectories()` only at construction time; directories gone after delete caused silent write failures. Now called before every packet and storage write.

**v0.31.58** — Session attribution now anchored to `recorder_wwuid` (the recording town's `.wildwest/registry.json` wwuid) instead of fragile `project_path` inference. The side panel filters by `recorder_wwuid` for town scope — unambiguous, set at export time, unaffected by multi-workspace Copilot sessions. `rebuildIndex` stamps missing `recorder_wwuid` on existing records (migration). Fallback to `project_path` for pre-migration records.

**v0.31.56/v0.31.57** — Fix `toolSpecificData.cwd` extraction: VSCode URI dicts use `path` key (not always `fsPath`). Revert aggressive rebuildIndex re-attribution that stole sessions from other workspace windows.

**v0.31.55** — (skipped — incomplete fix)

**v0.31.54** — Copilot workspace inference: also scan `response[].toolSpecificData.cwd` (in addition to `contentReferences`) to attribute Copilot sessions. Fixes older sessions that used tool invocations (e.g. terminal commands) as the only workspace evidence. Applies to both live pipeline and `rebuildIndex`.

**v0.31.53** — Fix Copilot sessions missing from town panel. v0.31.51 removed the `project_path` fallback entirely, leaving all `cpt` sessions with an empty path. Now the orchestrator infers `project_path` from `contentReferences` `fsPath` values — if any referenced file lives in the current workspace, the session is attributed to it. `rebuildIndex` also patches existing empty-path `cpt` records. Town-scope filter reverted to exact-match only.

**v0.31.52** — Town-scope session filter: restore ancestor-path matching (reverted in v0.31.53).

**v0.31.51** — Session pipeline: fix three `CopilotTransformer` bugs: (1) response content extraction now correctly reads array-format responses (null-kind items' `value` field) and user messages (`text` field); (2) `project_path` no longer falls back to active workspace for sessions with no `workspaceFolder` in raw data — false attributions eliminated; (3) `created_at` now uses `session.creationDate` instead of first-turn timestamp.

**v0.31.50** — Sessions: click any session row to open its JSON file (`staged/storage/sessions/<wwuid>.json`) in the editor.

**v0.31.49** — Town-scope filter: remove alias-basename fallback — sessions from any other project that happened to share the same folder name (e.g. an old `wildwest-vscode` checkout) no longer appear. Exact `project_path` match only.

**v0.31.48** — Sessions › Older: grouped by month (This month / Last month / Month YYYY), each collapsible. Items within a month show `MMM D` date prefix. Town-scope filter: ancestor-match removed from both session list and tool counter — only exact path or alias basename passes.

**v0.31.47** — Sessions: town-scope filter no longer includes ancestor paths (world/county root sessions no longer bleed into town's Recent/Today list).

**v0.31.46** — Sidebar heartbeat item: when flagged, tooltip shows unprocessed inbox memo subjects (same as status bar tooltip).

**v0.31.45** — Status bar tooltip: when heartbeat is flagged, lists unprocessed inbox memos by subject (up to 5, with overflow count). Subject extracted by stripping timestamp prefix.

**v0.31.44** — Status bar: add dedicated identity item (`$(person) TM(RHk)`) at priority 99, right of the main heartbeat item. Click it to edit identity directly. Shows warning color when unset.

**v0.31.43** — Identity row: restore click-to-edit (input box). contextValue='identity' kept for view/item/inline pencil (requires Developer: Reload Window after install).

**v0.31.42** — Identity row: remove click-to-edit (was opening palette on every click); edit only via hover pencil button. Requires window reload after install for menus contribution to take effect.

**v0.31.41** — Identity row: inline edit button (pencil icon) appears on hover in the sidebar. Click the row or the pencil to open the input box. Uses `view/item/inline` menu contribution with `contextValue = 'identity'`.

**v0.31.40** — Heartbeat item shows relative time instead of ISO timestamp: `10s ago`, `3m ago`, `2h ago`, `1d ago`. Full ISO timestamp still available in tooltip.

**v0.31.39** — Move Heartbeat item to bottom of sidebar root.

**v0.31.38** — Sidebar root redesign: Heartbeat, Scope, and Identity are now flat inline items at the root (no collapsible nodes). Heartbeat shows `● alive  Last beat: HH:MM` with pulse icon. Scope shows `town  [alias]` with home icon. Identity shows role/dyad inline, click to edit via Command Palette (`wildwest.setIdentity`). Scope row removed from inside Sessions section.

**v0.31.37** — Session buckets (Today/Yesterday/Last 7 days/Older) now show total turn count in parens: `Today   1 (30)`. Turn sums computed from `turn_count` field per session.

**v0.31.36** — Recent node: add per-tool breakdown rows (Copilot/Claude/Codex) as children, showing only sessions in the recent 8-day window. `countRecentByTool()` applies scope filter + date filter independently.

**v0.31.35** — Recent becomes a collapsible parent node; Today/Yesterday/Last 7 days are its children. Older stays at top level.

**v0.31.34** — Sessions section: rename `Total` row to `Recent  N  /  All  N` — shows recent (last 8 days) and all-time counts side by side. Tooltip breaks down recent as Today + Yesterday + Last 7 days.

**v0.31.33** — Sessions section: add `Total` stat row showing today + yesterday + last 7 days combined (recent window). Tooltip shows per-bucket breakdown. Stale CCX duplicate records (71 records with `.jsonl`-suffixed tool_sid) cleaned from staged storage.

**v0.31.32** — Cascading governance scope filter: town scope now shows direct-match sessions (basename === alias) AND ancestor-match sessions (project_path is a parent of the workspace, e.g. `~/wildwest` world root). Governance is recursive — world/county sessions cascade down to constituent towns. CLD `project_path` preserved as-is (scope level is meaningful data, not a bug).

**v0.31.31** — (superseded by v0.31.32)

**v0.31.30** — Fix ccx `tool_sid` double-extension bug: adapter was stripping `.json` from `.jsonl` filenames, leaving `tool_sid` as `rollout-...cb7.jsonl`. Now strips the correct extension per file type. `rebuildIndexFromRecords()` handles legacy records with `.jsonl`-suffixed tool_sid. All 71 ccx sessions now get correct `project_path` from `session_meta.payload.cwd` on rebuild.

**v0.31.29** — Add `wildwest.rebuildIndex` command + Utilities button. Scans `staged/storage/sessions/*.json`, patches ccx `project_path` from raw `session_meta.payload.cwd`, writes fresh `index.json`. Also runs automatically when `index.json` is missing on next Export Now / poll tick.

**v0.31.28** — Fix `CodexTransformer.getSessionMetadata()`: was returning `project_path: ''` for all sessions. Now extracts `session_meta.payload.cwd` in `parseRaw()` and surfaces it via `getSessionMetadata()`. All ccx sessions will now have correct project paths after rebuild.

**v0.31.27** — Town scope filter now matches by `alias` (`path.basename`) instead of full `project_path`. Fixes sessions missing when workspace was reorganized/moved (e.g. `counties/wildwest-ai/wildwest-framework` → `wildwest/counties/wildwest-ai/wildwest-framework`). Convention: `alias === basename(project_path)` is stable across moves.

**v0.31.26** — Sessions scope filter is now driven by `.wildwest/registry.json` (`scope` field), not a toggle. Town: exact workspace match. County: workspace IS county root — matches all towns within it. Territory (default): no filter. Displays as read-only `Scope: town  [wildwest-vscode]` row. `toggleSessionScope` command removed.

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

### Dyad Log Watcher
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
Writes periodic heartbeat sentinels to `.wildwest/telegraph/.last-beat` in the main checkout. Monitors town, county, and territory scopes for liveness. State is `alive`, `flagged` (unprocessed inbox memos), or `stopped` (stale sentinel).

### Telegraph Watcher
Monitors `.wildwest/telegraph/inbox/` in the active repo for inter-actor messages. Flags new memos in the status bar and sidebar heartbeat item.

### Town Init
Onboards any repo into the Wild West governance model via a guided wizard (`wildwest.initTown`). Creates the full v1 `.wildwest/` directory structure (telegraph, board, operations, dailies), generates `registry.json` with a stable UUIDv5 `wwuid`, and updates `.gitignore`. Designed to be run once per repo.

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
| Actor | Role, dyad, Edit identity… |
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
| Export Dyad Log Now | Manual export of all current sessions |
| Batch Convert All Sessions | Normalize raw → staged |
| Convert Exports to Markdown | Generate transcripts from staged JSON |
| Generate Index | Create INDEX.md for staged transcripts |
| Init Town | Initialize `.wildwest/` governance structure in the current repo |
| Start Heartbeat | Start heartbeat monitor |
| Stop Heartbeat | Stop heartbeat monitor |
| View Telegraph | Open `.wildwest/telegraph/` in Finder |
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
