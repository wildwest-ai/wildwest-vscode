# Wild West — VSCode Extension

Governance framework for AI-assisted development. Tracks devPair activity, exports chat sessions, monitors heartbeat, and coordinates actors across the Wild West county model.

**Current version:** 0.25.9

---

## What's New

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
