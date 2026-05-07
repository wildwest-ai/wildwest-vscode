# Wild West VS Code Repo Review Findings

Date: 2026-05-07 22:53 UTC

Scope: deep review of the TypeScript VS Code extension, package manifest, documentation, telegraph/heartbeat workflows, session export pipeline, MCP surface, and tests.

## Verification

- `npx tsc -p ./ --noEmit` passed.
- `npm run lint` passed.
- `npx jest --runInBand` passed: 7 suites, 68 tests.
- `git status --short` was clean after review.

## Key Findings

### 1. Telegraph Inbox Processing Is Broken for Delivered v2 Memos

Delivery writes remote memos into `telegraph/inbox/`, but `TelegraphInbox.getPendingMemos()` scans the telegraph root and only accepts filenames starting with `to-`. Current delivered filenames are shaped like `YYYYMMDD-HHMMZ-to-...`, so `wildwest.processInbox` can report an empty inbox after successful delivery.

References:

- `src/TelegraphInbox.ts:60`
- `src/HeartbeatMonitor.ts:655`

Recommendation: scan `telegraph/inbox/` and accept the same filename/frontmatter contract produced by delivery.

### 2. Acknowledgements Are Written Where Delivery Will Not Pick Them Up

`wildwest.telegraphAck` writes ack files to the telegraph root, while the delivery operator only scans `outbox/`. That means acks can be created locally but never delivered back to the sender.

References:

- `src/TelegraphCommands.ts:176`
- `src/HeartbeatMonitor.ts:699`

Recommendation: write all outbound memos and acks to `telegraph/outbox/`, then let the delivery operator route and archive them consistently.

### 3. Town Heartbeat Can Stay Falsely Flagged

`beatTown()` treats any non-hidden telegraph root entry except `history` as a flag. Since v2 creates `inbox/` and `outbox/` directories, a normal initialized town can appear flagged forever.

Reference:

- `src/HeartbeatMonitor.ts:777`

Recommendation: compute flagged state from unresolved memo files in `inbox/`, unresolved local root legacy memos, or explicit blocked/question ack states, not from expected directories.

### 4. Custom Export Paths Are Not Honored by the Packet Pipeline

Raw exports use `wildwest.exportPath`, but `PipelineAdapter` is initialized with `~/wildwest/sessions/{gitUsername}` regardless of configuration. Users with custom export paths get raw/staged output split across locations.

Reference:

- `src/sessionExporter.ts:63`

Recommendation: initialize the pipeline with `this.exportPath`, or document and configure a separate packet output path explicitly.

### 5. Broad Chat Export Behavior Starts by Default

The extension activates on `onStartupFinished`, and `wildwest.enabled` defaults to `true`, so export, heartbeat, and watchers start automatically. For a tool that scans Copilot, Codex, and Claude session stores, this should require explicit first-run consent and source scoping.

References:

- `package.json:17`
- `src/extension.ts:172`

Recommendation: add a first-run onboarding/consent flow with provider toggles, workspace-only mode, and clear disclosure of export location and data types.

### 6. Shutdown Does Not Fully Clean Up Session Polling

`SessionExporter.start()` creates a polling interval, but `dispose()` does not clear it. `deactivate()` also calls async cleanup without awaiting it.

References:

- `src/sessionExporter.ts:823`
- `src/sessionExporter.ts:1589`

Recommendation: make `deactivate()` return a promise, call `await exporter.stop()`, close watchers, stop the AI bridge, and dispose config listeners deterministically.

### 7. Git/Worktree Setup Has Avoidable Shell and Workflow Risk

Some git commands interpolate paths into shell strings, and `initTown` creates `_heartbeat` by checking out branches in the user's active worktree.

References:

- `src/WorktreeManager.ts:32`
- `src/TownInit.ts:83`

Recommendation: use `execFileSync` argument arrays and create `_heartbeat` with commands that do not switch the user's active checkout, such as `git branch _heartbeat HEAD`.

### 8. Command Contributions Are Incomplete

Commands such as `wildwest.startHeartbeat`, `wildwest.stopHeartbeat`, `wildwest.showStatus`, `wildwest.openExportFolder`, `wildwest.viewOutputLog`, and `wildwest.openSettings` are registered but not contributed in `package.json`, making them less discoverable.

References:

- `src/extension.ts:88`
- `package.json:22`

Recommendation: contribute all public commands, or deliberately keep internal commands unlisted and expose them only through trusted UI surfaces.

## Product and Feature Recommendations

### Highest Priority

1. Create a shared `TelegraphService` that owns address parsing, filename generation, inbox/outbox paths, ack generation, archiving, and delivery status.
2. Replace copied test implementations with tests that exercise production telegraph code.
3. Add first-run consent and provider selection before scanning chat stores.
4. Fix lifecycle cleanup across exporter polling, file watchers, HTTP hook server, MCP server, and configuration listeners.
5. Make `initTown` idempotent and repair-capable instead of exiting as soon as `.wildwest/` exists.

### Feature Improvements

- Add a Wild West side panel with Inbox, Outbox, History, Board, Heartbeat, and Actor state.
- Add a `Wild West: Doctor` command that validates registry, worktree, outbox/inbox dirs, actor role, export path, MCP status, hook port, and stale heartbeat state.
- Add memo actions: Ack Done, Blocked, Question, Defer, Archive, Open Source Memo, and Retry Delivery.
- Add delivery receipts and per-memo status: pending, delivered, failed, acknowledged, blocked.
- Add configurable export providers for GitHub Copilot, Copilot Edits, Codex CLI, and Claude Code.
- Add a privacy mode that redacts paths, environment-looking strings, and known secret patterns before staged export.
- Add workspace filters so users can limit exports to the active repo instead of all global AI session stores.
- Split MCP into a clear read-only server package or executable with real actor identity enforcement before adding write tools.
- Move tracked historical VSIX files out of git and keep releases in GitHub Releases or CI artifacts.

## Test Coverage Gaps

- End-to-end delivered memo in `inbox/` processed through `wildwest.processInbox`.
- Ack creation routed through `outbox/` and delivered back to the original sender.
- Heartbeat flagged/alive state with normal `inbox/`, `outbox/`, and `history/` directories present.
- Custom `wildwest.exportPath` with raw export and packet/staged output.
- Extension lifecycle activation/deactivation with polling intervals and hook server cleanup.
- `initTown` behavior in dirty worktrees and already partially initialized repos.
