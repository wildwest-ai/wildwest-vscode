# Wild West — VSCode Extension

Governance framework for AI-assisted development. Tracks devPair activity, exports chat sessions, monitors heartbeat, and coordinates actors across the Wild West county model.

**Current version:** 0.17.0 (v0.18.0 in development — telegraph protocol v2 simplification)

---

## What's New in v0.18.0 (Coming Soon)

**Telegraph Protocol Simplification:**
- **New addressing format**: Role-only (e.g., `CD`) replaces actor-specific format (e.g., `CD(RSn).Cpt`)
- **Town-to-town routing**: Wildcard patterns (e.g., `TM(*vscode)`) enable county-wide cross-town delivery
- **Backward compatible**: v0.18.0 accepts both formats; v0.19.0 removes old format support
- **Comprehensive unit tests**: 32 test cases covering all addressing scenarios

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

The **Wild West** status bar item (bottom right) shows watcher state and provides quick access to all commands via hover tooltip:

- Start / Stop Watcher
- Export Now
- Batch Convert to JSON
- Convert to Markdown
- Generate Index
- Open Export Folder
- View Output Log
- Settings

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

---

## Install

Download the latest `.vsix` from [Releases](https://github.com/wildwest-ai/wildwest-vscode/releases) and run:

```bash
code --install-extension wildwest-vscode-<version>.vsix
```

Then reload the VSCode window (`Cmd+Shift+P` → **Developer: Reload Window**).

---

## Requirements

- VS Code `^1.84.0`
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

### MCP integration

Wild West governance artifacts currently live as local files under `.wildwest/` (telegraph messages, scripts, docs). As the framework matures, these could migrate to an MCP server — exposing governance capabilities (`sendMessage`, `readTelegraph`, `reportHeartbeat`, etc.) as tools that any AI actor can call directly, regardless of editor or channel.

wildwest-vscode would evolve into the MCP host/transport layer, bridging VSCode UI with an MCP server. The `.wildwest/` directory would shrink to the worktree runtime only (fully gitignored), and Wild West would become a true actor-agnostic governance service.
