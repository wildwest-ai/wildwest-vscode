# Wild West VS Code Extension UI Layout

This document describes the actual Wild West extension UI elements implemented in `wildwest-vscode`.

## 1. Primary UI Surfaces

- **Editor Area**
  - hosts the VS Code editor and preview panes.
  - session preview documents are displayed using the `wildwest-session` virtual document scheme and the command `markdown.showPreview`.

- **Side Bar**
  - hosts the extension Tree View registered as `wildwest.sidepanel`.
  - appears in the Activity Bar as the Wild West side panel view.

- **Status Bar**
  - two custom status bar items are created:
    - `wildwest-status`
    - `wildwest-identity`
  - both are aligned to the right side of the status bar.

- **Webview Panel**
  - panel title: `📬 Telegraph`
  - view type: `wildwest.telegraphPanel`
  - created by `vscode.window.createWebviewPanel(..., ViewColumn.Beside, { enableScripts: true, retainContextWhenHidden: true })`
  - implemented in `src/TelegraphPanel.ts`.

- **Output Panel**
  - extension log channels shown in Output view:
    - `Wild West`
    - `Wild West Telegraph`

- **Command Palette / Quick Pick Menu**
  - registered command: `wildwest.menu`
  - menu content is built from command labels and command IDs in `src/extension.ts`.

## 2. Status Bar Elements

Implemented in `src/StatusBarManager.ts`.

- Status bar item: `wildwest-status`
  - icon: `$(eye)` when watching, `$(eye-closed)` when not watching
  - status dot: `●` for alive, `⚑` for flagged, `○` for dead/not running
  - label: `${scopeLabel}` derived from `heartbeatMonitor.detectScope()` and normalized to `Town`, `County`, or `Territory`
  - display content: `${eyeIcon} ${heartDot} ${scopeLabel}`
  - command: `wildwest.sidepanel.focus`

- Identity item: `wildwest-identity`
  - icon: `$(person)`
  - label: `${identitySetting}` if identity exists, otherwise `Set identity…`
  - display content: `$(person) ${identitySetting || 'Set identity…'}`
  - `identitySetting` is loaded from `wildwest.identity`
  - command: `wildwest.setIdentity`

- Tooltip contents and actions
  - header line: `Wild West · ${identitySetting} · ${scopeLabel}`
  - heartbeat link lines: `Start` / `Stop` watcher using `wildwest.startWatcher` or `wildwest.stopWatcher`
  - telegraph quick actions: `wildwest.telegraphSend`, `wildwest.telegraphAck`, `wildwest.viewTelegraph`, `wildwest.soloModeReport`
  - footer links: `wildwest.viewOutputLog`, `wildwest.openSettings`

- Refresh behavior
  - updates every 5 seconds via internal interval
  - listens for changes to `wildwest.identity` configuration
  - listens for workspace folder changes

## 3. Side Panel Tree View

Implemented in `src/SidePanelProvider.ts`.

### Root panel sections

- `Scope` item
  - label pattern: `${scope}  [${scopeLabel}]`
  - icons: `home` for town, `organization` for county, `globe` for territory
  - tooltip: explains current scope filter from `.wildwest/registry.json`

- `Identity` item
  - icon: `person`
  - label based on `wildwest.identity` and parsed identity text
  - command: `wildwest.setIdentity`

- `Sessions` section
  - root section label: `Sessions`
  - section ID: `sessions`
  - child buckets: `sessions:recent`, `sessions:today`, `sessions:yesterday`, `sessions:last7d`, `sessions:older`
  - session rows open `wildwest.openSessionPreview`

- `Utilities` section
  - root section label: `Utilities`
  - section ID: `utilities`
  - contains utility actions such as open settings, validate registry, and doctor commands

- `Inbox` section
  - root section label: `Inbox (N)` where `N` is count from `.wildwest/telegraph/inbox`
  - section ID: `inbox`
  - child items list inbox memo files

- `Outbox` section
  - root section label: `Outbox (N)` where `N` is count from `.wildwest/telegraph/outbox`
  - section ID: `outbox`
  - child items list outbox memo files

- `History` section
  - root section label: `History (N)` where `N` is count from history memo files
  - section ID: `history`
  - child items open historical memo URIs

- `Board` section
  - root section label: `Board (N)` where `N` is count from board files
  - section ID: `board`
  - child items open board document URIs

- `Receipts` section
  - root section label: `Receipts (N)` where `N` is count from delivery receipt files
  - section ID: `receipts`
  - child items open receipt URIs

- `Heartbeat` item
  - label includes heartbeat state, last beat age, and interval label
  - icon: `refresh`
  - command: `wildwest.forceHeartbeat`

- `Watcher` item
  - label indicates whether session export watcher is active
  - updated by `SessionExporter` via `SidePanelProvider.setWatching()`

### Side panel behavior

- uses `SidePanelItem` class extending `vscode.TreeItem`
- root sections are collapsible using `vscode.TreeItemCollapsibleState.Collapsed`
- child items may set `resourceUri` and a default `vscode.open` command
- refresh triggered by `refresh()` and by an internal 10-second timer
- `refresh()` is also called when session watcher starts/stops and when prompt index rebuild completes
- supports nested section IDs such as `sessions:tool:<tool>`, `sessions:last7d:<date>`, and `sessions:older:<month>`

## 4. Telegraph Webview UI

Implemented in `src/TelegraphPanel.ts`.

### Panel shell

- header container `div.header`
  - heading element `h2` with text content `📬 Telegraph`
  - button `#btnRefresh` with icon-only display content `↻`
  - button `#btnCompose` with display content `✎ Compose`

- tab bar `div.tabs` — 3 tabs total
  - tab `div.tab[data-tab="inbox"]` with label `Inbox`
    - badge `#badgeInbox` bound to `inboxWires.length`
  - tab `div.tab[data-tab="outbox"]` with label `Outbox`
    - badge `#badgeOutbox` bound to `outboxWires.length`
  - tab `div.tab[data-tab="all"]` with label `All`
    - badge `#badgeAll` bound to `allWires.length`

### Search and filters

- status filter area `#statusFilter`
  - renders filter buttons with class `.sf-btn`
  - button labels are based on `CHIP_CONFIG`
    - `inbox` filters: `New`, `Read`, `Archived`, `All`
    - `outbox` filters: `Draft`, `Pending`, `Failed`, `Sent`, `Delivered`, `Read`, `Archived`
  - default active status by tab is set from `initStatusFilter()`
- search bar `#searchBar`
  - input field `#searchInput`
  - placeholder text: `Search wires…`
  - visible only when `activeTab === 'all'`

### Bulk action UI

- bulk action bar `#bulkBar`
  - checkbox `#selectAll` with label `All`
    - selects all visible wires in the current tab list
  - status label span `#selectedCount` with text `0 selected` when empty
  - dropdown `#bulkStatus`
    - option values: `draft`, `pending`, `sent`, `delivered`, `archived`
  - button `#bulkApply` with text content `Apply`
  - button `#bulkClear` with icon-only display content `✕`
  - bar visibility toggles based on `selectedWwuids.size`

### Main layout

- left pane `#listPane`
  - renders wire lists grouped by scope label or status sections
- right pane `#detailPane`
  - initial placeholder: `Select a wire to read`
  - displays selected wire metadata, body, timeline, and action buttons
  - uses class `empty-detail` when no wire is selected

### Wire list row elements

Each wire row includes:
- row container `.wire-row[data-wwuid]`
- selection checkbox `.wire-check[data-wwuid]`
- content wrapper `.wire-content`
- subject line `.subject`
- metadata line `.meta`
- status badge `.badge-status.badge-<status>`
- short ID / hash line rendered below metadata

### Wire detail pane elements

- detail pane container `#detailPane`
- metadata table `.wire-meta-table`
  - rows include `From`, `To`, `Subject`, `Type`, `Date`, etc.
- wire content block `.wire-body`
- failure section styled with `.section-label`
- timeline container `.timeline`
- timeline row `.timeline-item`
- timeline indicator `.timeline-dot`
- action button container `.push-bar`

### Wire detail action buttons

Buttons in detail view use `data-*` attributes and these visible labels:
- `button[data-push="copilot"]` — label `→ Copilot`
- `button[data-push="claude"]` — label `→ Claude`
- `button[data-push="codex"]` — label `→ Codex`
- `button[data-send-draft="<wwuid>"]` — label `Send`
- `button[data-retry-wire="<wwuid>"]` — label `Retry Now`
- `button[data-mark-read="<wwuid>"]` — label `Mark Read`
- `button[data-reply="<wwuid>"]` — label `↻ Reply`
- `button[data-archive="<wwuid>"]` — label `Archive`

### Compose drawer elements

- drawer container `#composeDrawer`
  - class toggled to `open` when visible
- form container `.compose-form`
- field rows `.compose-row`
- field labels: `To`, `Type`, `Subject`
- input `#cTo` with placeholder `CD(RSn)`
- select `#cType`
  - option values: `status-update`, `assignment`, `scope-change`, `question`, `incident-report`, `request`, `notification`
- input `#cSubject` with placeholder `my-topic-slug`
- textarea `#cBody` with placeholder `Wire body… (type 3+ chars to see past prompts)`
- prompt dropdown `#promptDropdown`
  - hidden by default via `display:none`
- error banner `#composeError`
- button `#btnCancel` with text content `Cancel`
- button `#btnSend` with text content `Send`

### Prompt suggestion UI

- suggestions rendered inside `#promptDropdown`
- each suggestion uses `.prompt-item` and `data-idx`
- prompt selection inserts text into `#cBody`

### Client-side interaction wiring

The embedded script binds these UI actions:
- `.tab` clicks for tab switching
- `.sf-btn` clicks for status filter updates
- `#searchInput` `input` events for query filtering
- `#btnRefresh`, `#btnCompose`, `#btnCancel`, `#btnSend`
- `#listPane` click events for row selection and checkbox toggles
- `#detailPane` click events for action buttons and reply flows
- `#selectAll`, `#bulkApply`, `#bulkClear` bulk action controls
- message handling from `window.postMessage`

### Webview host integration

- posts messages to the extension host for actions
- receives wire data payloads and error/sent events from host
- supports host refresh via `TelegraphPanel.refresh()`

## 5. Session Preview

Implemented in `src/SessionPreviewProvider.ts`.

- text document content provider scheme: `wildwest-session`
- registered via `vscode.workspace.registerTextDocumentContentProvider`
- preview URI created by `SessionPreviewProvider.uriFor(wwuid, exportPath)`
- opened via command `wildwest.openSessionPreview`
- host command uses `markdown.showPreview` to render the content
- content source is `exportPath/staged/storage/sessions/<wwuid>.json`
- renders session metadata and conversation turns into Markdown
- includes tool name, model, project path, timestamps, turn count, and scope references
- collapses assistant fragments and preserves thinking fragments for readability

## 6. Additional UI Components

- **Prompt completion provider**
  - `PromptCompletionProvider` is registered for `markdown` language
  - provides inline completion suggestions from the prompt index

- **Commands**
  - extension registers commands in `src/extension.ts`
  - these include:
    - `wildwest.startWatcher`
    - `wildwest.stopWatcher`
    - `wildwest.exportNow`
    - `wildwest.toggleSessionSortBy`
    - `wildwest.rebuildIndex`
    - `wildwest.buildPromptIndex`
    - `wildwest.openExportFolder`
    - `wildwest.viewOutputLog`
    - `wildwest.openSettings`
    - `wildwest.setIdentity`
    - `wildwest.initTown`
    - `wildwest.initCounty`
    - `wildwest.initTerritory`
    - `wildwest.startHeartbeat`
    - `wildwest.stopHeartbeat`
    - `wildwest.openTelegraphPanel`
    - `wildwest.refreshTelegraphPanel`
    - `wildwest.menu`
    - `wildwest.validateRegistry`
    - `wildwest.doctor`
  - many commands are also surfaced through the side panel item actions and status bar tooltip links

- **Output channels**
  - `Wild West` logs core extension activity
  - `Wild West Telegraph` logs Telegraph webview events and wire events

## 7. Summary

The extension UI is built around:
- a custom side panel Tree View,
- a custom Telegraph webview panel,
- status bar indicators,
- markdown preview session export,
- command palette integration,
- and output channel logging.
