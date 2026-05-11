# Wild West — VSCode Extension

Governance framework for AI-assisted development. Tracks dyad activity, exports chat sessions, monitors heartbeat, and coordinates identities across the Wild West county model.

See [CHANGELOG.md](CHANGELOG.md) for version history and What's New.

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
