# AI Tool Programmatic APIs

**Scope:** Research findings on how each AI coding tool exposes programmatic APIs  
**Authored:** 2026-05-07T12:04Z  
**Relevance:** Determines what wildwest-vscode can and cannot do to communicate WITH each AI tool

---

## Why This Matters

The wildwest-vscode extension currently communicates with AI tools passively — it reads
session files that each tool writes to disk (`.wildwest/sessions/`). The question this
document answers: **can our extension actively communicate to or trigger actions in each
AI tool's chat session?**

The answer depends heavily on tool version. APIs introduced in one release may not exist in
an older install.

---

## 1. GitHub Copilot Chat

### Version Baseline

| Component | Minimum Version | Notes |
|---|---|---|
| VS Code | 1.90+ | Chat Participant API GA |
| VS Code | 1.95+ | Language Model API with tool support |
| GitHub Copilot Chat extension | 0.22+ | Participant + LM API stable |

The Chat Participant API and Language Model API are part of **VS Code's built-in extension
API**, not Copilot's own versioned release. The relevant VS Code version gates what is
available.

### What Is Exposed

#### Chat Participant API (`vscode.chat`)

```typescript
// Makes your extension BE a participant — responds to @your-ext mentions
const participant = vscode.chat.createChatParticipant('wildwest', handler);
participant.iconPath = vscode.Uri.file('icon.png');
```

- Your extension **responds to** `@wildwest ask something` in the chat panel
- You receive the conversation history and can stream a response back
- You can register slash commands: `/wildwest status`, `/wildwest memo`
- **Cannot** inject into a running Copilot conversation or initiate one

#### Language Model API (`vscode.lm`)

```typescript
// Direct stateless LLM call — no chat session involved
const [model] = await vscode.lm.selectChatModels({ family: 'gpt-4o' });
const response = await model.sendRequest(messages, {}, token);
```

- Supported models (as of VS Code 1.95): `gpt-4o`, `claude-3.5-sonnet`, `claude-3.7-sonnet`
- Stateless — each call is independent, no session context
- Copilot subscription required for the user; extension gets access through VS Code
- Good for: generating content, analyzing files, answering questions in extension code

#### Tool Registration

Extensions can register tools that Copilot's agent **calls back** during agentic runs:

```typescript
vscode.lm.registerTool('wildwest_read_memo', {
  invoke: async (input, token) => { /* called by Copilot */ }
});
```

The AI initiates the call to your extension, not the other way around.

### Cannot Do

- Push a message into a running Copilot Chat session
- Initiate a new Copilot Chat session programmatically
- Read conversation history from another session

### Community Status

Requests for "extension-initiated chat messages" have been open on the VS Code GitHub repo
for years (`microsoft/vscode` issues). No shipping API as of 2026-05-07.

---

## 2. Claude Code

### Version Baseline

| Feature | Minimum Version | Notes |
|---|---|---|
| Hooks (basic) | v2.0+ | `PreToolUse`, `PostToolUse`, `Stop`, `SessionStart` |
| HTTP hooks | v2.1+ | `type: "http"` — POST to a local server |
| Prompt/agent hooks | v2.1+ | `type: "prompt"`, `type: "agent"` |
| Channels (push into session) | **v2.1.80+** | Research preview; Telegram, Discord, iMessage, custom |
| `defer` in PreToolUse | **v2.1.89+** | Pause + resume tool call flow |
| MCP tool hooks | v2.1+ | `type: "mcp_tool"` |

Check installed version: `claude --version`

### What Is Exposed

#### Hooks System

Hooks fire at lifecycle points and run shell commands, HTTP endpoints, MCP tools, LLM
prompts, or subagents. Configured in `~/.claude/settings.json` or
`.claude/settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [{ "type": "command", "command": "/path/to/script.sh" }]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "http",
            "url": "http://localhost:8787/hook",
            "timeout": 30
          }
        ]
      }
    ]
  }
}
```

**All hook events:**

| Event | Blockable | Notes |
|---|---|---|
| `SessionStart` | No | Session opened or resumed |
| `UserPromptSubmit` | Yes | Before Claude processes a prompt |
| `PreToolUse` | Yes | Before any tool call (Bash, Edit, Write, MCP, etc.) |
| `PermissionRequest` | Yes | Before permission dialog shows |
| `PostToolUse` | No | After tool completes |
| `PostToolBatch` | Yes | After full parallel batch resolves |
| `Stop` | Yes | When Claude finishes a turn |
| `SubagentStart/Stop` | No / Yes | Subagent lifecycle |
| `TaskCreated/Completed` | Yes | Agent team task lifecycle |
| `FileChanged` | No | Watched file changed on disk |
| `SessionEnd` | No | Cleanup on exit |
| + 10 more | — | See full reference |

**HTTP hooks** are the key integration point for wildwest-vscode: run a local HTTP server
in the extension, and Claude Code will POST every tool call, stop event, and prompt
submission to it.

```json
{
  "hooks": {
    "Stop": [{
      "hooks": [{
        "type": "http",
        "url": "http://localhost:8787/claude-stop",
        "timeout": 15
      }]
    }]
  }
}
```

The hook payload includes `session_id`, `transcript_path`, `cwd`, `last_assistant_message`.

#### Channels (Push INTO Running Session)

**Requires Claude Code v2.1.80+.** Channels are MCP servers that push events into a
running Claude Code session — the only mechanism that lets external code inject a prompt
while Claude is already open.

```bash
# Start with a channel enabled
claude --channels plugin:telegram@claude-plugins-official
claude --channels plugin:my-wildwest-channel

# Or a custom dev channel (during preview)
claude --dangerously-load-development-channels
```

A custom Channel plugin receives a message from any source (Telegram, Discord, webhook,
or your VSCode extension over localhost) and delivers it as a `<channel source="...">` 
event inside Claude's session. Claude reads it and responds.

**Potential wildwest integration:** The extension could run a Channel MCP server that
listens on a named pipe or local socket. When the extension needs to alert Claude (e.g.,
new telegraph memo arrived), it sends to the Channel and Claude reacts in its open session.

**Limitation:** Requires `--channels` flag at startup. Claude must be running. Team/Enterprise
orgs need admin to enable `channelsEnabled`.

#### Non-interactive Mode

```bash
# Scriptable, one-shot
claude -p "process the telegraph inbox and write a status memo"

# JSON Lines output stream
claude -p --json "do something" | jq '.type'

# Resume a prior session
claude -p --resume <session-id> "continue where you left off"
```

Good for: wildwest heartbeat scripts triggering Claude runs on a schedule.

---

## 3. Codex CLI (OpenAI)

### Version Baseline

| Feature | Minimum Version | Notes |
|---|---|---|
| `codex exec` (non-interactive) | v0.100+ | Stable in npm package |
| Hooks | v0.120+ | Feature-flagged: `codex_hooks = true` in config.toml |
| `@openai/codex-sdk` (TypeScript) | v0.1+ | npm package, Node.js 18+ |
| Python SDK | experimental | Local checkout of codex repo required |
| `--json` JSONL output | v0.110+ | Machine-readable event stream |

Latest release as of research: **`rust-v0.128.0`** (2026-05-07)  
Install: `npm i -g @openai/codex` or `brew install --cask codex`  
Check version: `codex --version`

### What Is Exposed

#### Hooks System

Similar in design to Claude Code hooks. Feature-flagged, must enable in `config.toml`:

```toml
[features]
codex_hooks = true
```

Then configure in `.codex/hooks.json` or inline in `config.toml`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "^Bash$",
        "hooks": [{
          "type": "command",
          "command": "python3 /path/to/pre_tool_policy.py",
          "timeout": 30
        }]
      }
    ],
    "Stop": [
      {
        "hooks": [{
          "type": "command",
          "command": "python3 /path/to/stop_handler.py"
        }]
      }
    ]
  }
}
```

**Hook events (current):** `SessionStart`, `PreToolUse`, `PermissionRequest`,
`PostToolUse`, `UserPromptSubmit`, `Stop`

**Note:** Codex hooks currently only support `type: "command"` (no HTTP hook type yet).
Your script must be a local process that reads JSON on stdin.

Hook input fields:

| Field | Type | Description |
|---|---|---|
| `session_id` | string | Current thread/session ID |
| `transcript_path` | string \| null | Path to transcript file |
| `cwd` | string | Working directory |
| `hook_event_name` | string | Event that fired |
| `model` | string | Active model slug |
| `turn_id` | string | Turn-scoped (PreToolUse, PostToolUse, Stop) |

#### Non-interactive Mode (`codex exec`)

```bash
# Basic — streams progress to stderr, final message to stdout
codex exec "summarize the repository structure"

# JSON Lines event stream
codex exec --json "fix the failing tests" | jq '.type'

# With structured output schema
codex exec --output-schema ./schema.json "extract project metadata"

# Resume prior session
codex exec resume --last "implement the plan from last time"
codex exec resume <SESSION_ID> "continue"

# Pipe input as context
npm test 2>&1 | codex exec "summarize the failures and propose a fix"
```

JSONL event types: `thread.started`, `turn.started`, `turn.completed`, `item.started`,
`item.completed`, `error`. Item types include `agent_message`, `command_execution`,
`file_changes`, `mcp_tool_call`, `web_search`, `plan_update`.

#### Codex SDK (TypeScript)

```typescript
import { Codex } from "@openai/codex-sdk";

const codex = new Codex();
const thread = codex.startThread();

// Run a prompt on the thread
const result = await thread.run("Make a plan to fix the CI failures");
console.log(result);

// Continue the same thread
const result2 = await thread.run("Implement the plan");

// Resume a past thread by ID
const thread2 = codex.resumeThread("<thread-id>");
const result3 = await thread2.run("Pick up where you left off");
```

Install: `npm install @openai/codex-sdk`  
Requires Node.js 18+. Controls the local Codex app-server over JSON-RPC.

### Cannot Do

- Push a message into a running interactive Codex TUI session (no Channels equivalent)
- HTTP hooks (command-only for now)

---

## Summary Comparison

| Capability | Copilot (VS Code 1.95+) | Claude Code (v2.1.80+) | Codex CLI (v0.120+) |
|---|---|---|---|
| Extension registers as AI participant | ✅ `vscode.chat` | ❌ | ❌ |
| Extension makes LLM calls directly | ✅ `vscode.lm` | ❌ | ❌ |
| AI calls back into extension (tools) | ✅ tool registration | ❌ | ❌ |
| Lifecycle hooks (shell/command) | ❌ | ✅ | ✅ (feature flag) |
| Lifecycle hooks (HTTP to local server) | ❌ | ✅ | ❌ (not yet) |
| Push message into running session | ❌ | ✅ Channels | ❌ |
| Scriptable non-interactive mode | ❌ | ✅ `claude -p` | ✅ `codex exec` |
| Programmatic SDK | ❌ | ❌ (CLI only) | ✅ `@openai/codex-sdk` |
| Resumable sessions | ❌ | ✅ `--resume` | ✅ `resume --last` |
| JSONL event stream | ❌ | ✅ `--json` | ✅ `--json` |

---

## Implications for wildwest-vscode

### What We Could Build (Ranked by Effort)

**1. Claude Code HTTP hooks receiver (Low effort)**  
Run a local HTTP server in the extension. Register a `PostToolUse` or `Stop` HTTP hook
in `~/.claude/settings.json`. The extension receives every AI action in real time. This
could auto-export sessions without polling, and detect when Claude writes a telegraph memo.

**2. Copilot `@wildwest` participant (Medium effort)**  
Register as a chat participant. Users type `@wildwest status` to get board/branch/memo
summaries without leaving the chat panel. Uses `vscode.chat.createChatParticipant()`.

**3. Codex SDK integration (Medium effort)**  
Use `@openai/codex-sdk` to programmatically spawn Codex threads from the extension — e.g.,
have the extension trigger a Codex run on a telegraph memo automatically.

**4. Claude Code Channel plugin (High effort)**  
Build a custom Channel MCP server. When the extension detects a new inbound telegraph memo,
it pushes it directly into Claude's open session. Claude sees it and can respond without
the user switching windows.

### Current Architecture vs. What's Possible

| | Current | Possible |
|---|---|---|
| Session capture | 5s polling → read files | HTTP hook → push on event |
| Claude awareness | None | Channel push or HTTP hook callback |
| Copilot interaction | None | `@wildwest` participant |
| Automation | Manual | `codex exec` / `claude -p` in heartbeat |

---

## References

- [VS Code Chat Participant API](https://code.visualstudio.com/api/extension-guides/chat)
- [VS Code Language Model API](https://code.visualstudio.com/api/extension-guides/language-model)
- [Claude Code Hooks Reference](https://code.claude.com/docs/en/hooks)
- [Claude Code Channels](https://code.claude.com/docs/en/channels)
- [Codex Hooks](https://developers.openai.com/codex/hooks)
- [Codex Non-interactive Mode](https://developers.openai.com/codex/noninteractive)
- [Codex SDK](https://developers.openai.com/codex/sdk)

---

**Last Updated:** 2026-05-07T12:04Z  
**By:** TM(RHk).Cpt (research session)
