# Wild West VS Code Extension UI Layout

This document describes the actual Wild West extension UI elements implemented in `wildwest-vscode`.

## 1. Primary UI Surfaces

- **Editor Area**
  - hosts the VS Code editor and preview panes.
  - session preview documents are displayed using the `wildwest-session` virtual document scheme and the command `markdown.showPreview`.

- **Side Bar**
  - hosts the extension Tree View registered as `wildwest.sidepanel`.
  - appears in the Activity Bar as the Wild West side panel view.

- **Activity Bar (View Container)**
  - the Activity Bar hosts view containers; this extension registers the `Wild West` view container.
  - contribution: `contributes.viewsContainers.activitybar` in `package.json` with `id: "wildwest-panel"`, `title: "Wild West"`, and `icon: media/wildwest-icon.svg`.
  - correct UI term: this is a "view container" (Activity Bar item) that holds one or more "views"; the Side Bar `wildwest.sidepanel` is a view inside that container.
  - view-title actions (icons in the view header) are provided via `contributes.commands` + `contributes.menus["view/title"]` and include `$(refresh)` and `$(mail)` for `wildwest.refreshSidePanel` and `wildwest.openTelegraphPanel` respectively.

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

## 8. Selectors & IDs

Provide an authoritative mapping of DOM selectors and element IDs used by the Telegraph webview and other UI surfaces. This is useful for tests, automation, and designers.

- `#badgeInbox` — Inbox tab badge (source: `src/TelegraphPanel.ts`).
- `#badgeOutbox` — Outbox tab badge.
- `#badgeAll` — All tab badge.
- `#btnRefresh` — header refresh button.
- `#btnCompose` — header compose button.
- `.tab[data-tab="inbox"]`, `.tab[data-tab="outbox"]`, `.tab[data-tab="all"]` — tab elements.
- `#searchInput` — search input in `all` tab.
- `#composeDrawer` — compose drawer container; `.compose-form` fields inside.
- `.wire-row[data-wwuid]` — wire list row selector (data attribute contains `wwuid`).
- `.wire-check[data-wwuid]` — per-row checkbox.
- `#listPane` / `#detailPane` — primary split panes.

When adding or changing selectors, update this section as the single source of truth.

## 9. CSS & Theming

Document the CSS classes and theme tokens used for key visual semantics.

- Badge styling: `.tab .badge` uses VS Code theme tokens: `var(--vscode-badge-background)` and `var(--vscode-badge-foreground)` so badge color is theme-aware and not a semantic alert color.
- Status badges: `.badge-status.<status>` map to semantic styles (e.g., `badge-status.sent`, `badge-status.failed`). Keep these visually secondary and avoid using red/orange solely to indicate count metadata.
- Use `color: var(--vscode-foreground)` and `background: transparent` for neutral metadata where appropriate.

Guideline: badges must remain decorative/count-only; do not rely on color alone to communicate read/unread or error states (also see Accessibility).

## 10. Accessibility & Keyboard

Checklist for webview and side panel accessibility:

- Tablist semantics: mark the tab container with `role="tablist"` and each `.tab` with `role="tab"`, include `aria-selected="true|false"` and `aria-controls` referencing the panel ID.
- Keyboard navigation: Left/Right/Home/End should move focus between tabs; Enter/Space activates a tab.
- Buttons: ensure all icon-only buttons have `aria-label` attributes (`#btnRefresh` → `aria-label="Refresh"`).
- Focus management: when opening the compose drawer, move focus to the first form input and return focus when closed.
- Color contrast: ensure badges, status badges, and important icons meet WCAG contrast requirements in light/dark/high-contrast themes.
- Screen reader text: provide visually-hidden labels for content that is icon-only (e.g., compose, refresh, reply actions).

Run automated accessibility checks (axe-core) against the webview HTML during PRs.

## 11. Localization

Plan for UI text localization:

- Extract static strings from webview HTML/JS into a single message map (e.g., `i18n.json`) so translations can be added later.
- Side panel labels, view titles, tooltips, placeholder text and button labels should reference the message map, not hard-coded English strings.
- Document which strings are intentionally English-only (if any) and why.

## 12. UI Tests & Automation

Test guidance to prevent regressions:

- Unit tests: assert that required selectors exist and that host <-> webview message contracts operate (expand `TelegraphPanel` tests to assert selectors listed in Section 8).
- Visual regression: add Playwright/CSS snapshot tests for header, tabs, and detail view in light and dark themes.
- Accessibility tests: integrate axe-core checks in CI for the webview HTML snapshot.
- E2E: if feasible, create a Playwright scenario that opens the webview panel and exercises tab switching, compose flow, and bulk actions.

## 13. PostMessage Contract (Host ↔ Webview)

Document the message types and payload shapes used by `window.postMessage` between webview and extension host. Example (informal):

- From host -> webview:
  - `{ type: 'data:update', payload: { inbox: [...], outbox: [...] } }`
  - `{ type: 'status:error', payload: { message: '...' } }`
- From webview -> host:
  - `{ type: 'telegraph:refresh' }`
  - `{ type: 'telegraph:compose', payload: { to, type, subject, body } }`
  - `{ type: 'telegraph:select', payload: { wwuid } }`

Keep precise JSON schemas adjacent to the implementation (`src/TelegraphPanel.ts`) and update this doc on contract changes.

## 14. Behavioral Edge Cases

Document expected behavior for edge conditions:

- Narrow widths: tabs should overflow gracefully and the detail pane should collapse below the list pane.
- Long subject lines: truncate with ellipsis and expose full value on tooltip or via detail view.
- Empty lists: render clear empty-state UI with a muted icon and action to compose or refresh.
- Host disconnected / errors: show an inline error banner with retry link and a clear explainable message.

## 15. Branch Implementation Checklist

Use the following checklist when implementing the `feat/telegraph-ui-ux-improvement` branch. Each item should be done and reviewed in-branch before merging to `main`.

- Add `Selectors & IDs` table in this doc (done).
- Add or update CSS rules to ensure badge semantics remain neutral and use theme tokens.
- Add `media/telegraph.svg` placeholder in-branch and a `contributes.commands` entry `wildwest.telegraph` (icon points to the placeholder).
- Replace `📬` in the webview header with an icon-driven element and ensure accessible labeling.
- Add unit tests asserting selectors and message contract behavior.
- Add visual snapshots for header/tabs in light/dark themes.
- Run accessibility checks and fix issues found.

