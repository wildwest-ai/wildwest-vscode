# Wild West — VSCode Extension

Governance framework for AI-assisted development. Tracks devPair activity, exports chat sessions, monitors heartbeat, and coordinates actors across the Wild West county model.

---

## Features

### devPair Log Watcher
Automatically polls chat session storage every 5 seconds and exports raw sessions to `~/wildwest-vscode/{git-username}/raw/`:

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
| `wildwest.exportPath` | `~/wildwest-vscode/{git-username}/` | Export directory. Supports `~` and `${userHome}` |
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
