# Proposal: AI Tool Hook Integration

**Status:** Draft — pending S(R) or CD(RSn) approval  
**Authored:** 2026-05-07T12:13Z  
**Revised:** 2026-05-07T12:44Z  
**By:** TM(RHk).Cpt  
**Based on:** `docs/ai-tool-programmatic-apis.md` (research session 2026-05-07)

---

## Problem Statement

The wildwest-vscode extension currently communicates with AI tools **passively and
inefficiently**:

1. `SessionExporter` runs `setInterval` every **5 seconds** polling disk for new session
   files — wasteful, introduces up to 5s lag, and misses the exact moment a turn ends.
2. Telegraph memo writes by Claude are only detected on the next poll cycle. Rule 23 requires
   timely processing, but our detection is blind between polls.
3. There is no in-chat visibility into wildwest state. Users must leave chat to check the
   board, inbox, or branch status.

Research into each AI tool's programmatic APIs (see `docs/ai-tool-programmatic-apis.md`)
revealed that better integration points exist today — without waiting for new APIs.

A direct implementation against Claude Code's specific hook format would create tight
coupling: every new AI tool (Codex CLI, future tools) would require changes to core
extension logic. This proposal adds an **abstraction layer** so core components stay
tool-agnostic.

---

## Architecture: AI Tool Adapter Layer

### Assumption

Each AI tool has — or will have — a **provider interface** through which it communicates
lifecycle events. The form varies by tool and matures over time:

| Tool | Provider Today | Direction | Version Gate |
|---|---|---|---|
| Claude Code | HTTP hooks → extension | Tool pushes to us | v2.1+ |
| Claude Code | MCP Channels server | Extension connects to tool | v2.1.80+ (preview) |
| Codex CLI | `@openai/codex-sdk` (Node) | Extension calls SDK | v0.1+ |
| Codex CLI | Command hooks | Tool pushes to us | v0.120+ |
| GitHub Copilot | `vscode.lm` API | Extension calls API | VS Code 1.95+ |
| GitHub Copilot | `vscode.chat` participant | Extension is provider | VS Code 1.90+ |

The extension does not need to pick one communication direction globally. Each adapter
owns the details of how to connect to its tool's provider — push or pull, MCP or HTTP or
SDK. Core components never see those details.

### Architectural Constraint: Client Layer vs. Service Layer

**Current state:** AI provider services (Anthropic API, OpenAI API) are stateless token
streams. They have no concept of lifecycle events — no `turn-end`, no `file-changed`, no
`session-start`. Those signals exist only at the **chat client layer** (Claude Code, Codex
CLI, Copilot Chat), which runs locally and observes its own filesystem and session state.

This is why wildwest's observability integrations target chat clients today rather than
upstream services:

```
Service layer (Anthropic API, OpenAI API)
  ✗ No lifecycle events
  ✗ No filesystem awareness
  ✓ Good for: making wildwest's own LLM calls (P3 / @wildwest participant)

Chat client layer (Claude Code, Codex CLI, Copilot Chat)
  ✓ turn-end, file-changed, session-start/end
  ✓ Transcript paths, cwd, session IDs
  ✓ Good for: observability, session export, telegraph detection (P1, P2)
```

**This constraint is temporary.** AI providers are moving fast. Any of the following
could appear soon:

- Anthropic exposes a streaming session lifecycle API (webhooks or SSE)
- OpenAI adds a persistent session protocol to the Assistants API
- A provider ships an MCP server that emits tool-call and turn events directly

**The adapter layer is already ready for this.** When a service-level provider API
appears, a new adapter (e.g. `ClaudeServiceAdapter`) connects to it and emits the same
`AIToolEvent` interface. The bridge and all core components are unaffected. The chat
client adapter and the service adapter can coexist — whichever fires first wins.

### Principle

Core extension components (`SessionExporter`, `TelegraphWatcher`) must not know which AI
tool is running or how it communicates. They subscribe to a normalized event stream.
Each adapter connects to its tool's provider, translates the raw signal, and emits a
standard `AIToolEvent`.

```
┌──────────────────────────────────────────────────────────────────┐
│                       wildwest-vscode                            │
│                                                                  │
│  SessionExporter ──┐                                             │
│  TelegraphWatcher ─┼──► AIToolBridge (normalized event bus)     │
│  CopilotParticipant┘         ▲              ▲            ▲      │
│                              │              │            │      │
│                    ClaudeCode│    Codex     │  Future    │      │
│                    Adapter   │    Adapter   │  Adapter   │      │
└──────────────────────────────┼──────────────┼────────────┼──────┘
                               │              │            │
                    ┌──────────┴──┐  ┌────────┴──┐  ┌────┴──────┐
                    │ HTTP hooks  │  │ codex SDK │  │ MCP / API │
                    │ MCP server  │  │ cmd hooks │  │   (TBD)   │
                    └─────────────┘  └───────────┘  └───────────┘
                        Claude Code      Codex CLI     Future tool
```

The direction of communication (push vs pull, HTTP vs MCP vs SDK) is an adapter
implementation detail, not an interface concern.

### Standard Interface

```typescript
// src/aiToolAdapters/types.ts

export interface AIToolEvent {
  type: 'turn-end' | 'file-changed' | 'session-start' | 'session-end';
  tool: string;           // 'claude-code' | 'codex' | ...
  sessionId?: string;
  transcriptPath?: string;
  changedFile?: string;
  cwd?: string;
  raw?: unknown;          // tool-specific payload for debugging
}

export interface AIToolAdapter {
  readonly toolId: string;
  /** Connect to the tool's provider (HTTP server, MCP client, SDK init, etc.) */
  start(): Promise<void>;
  /** Disconnect and clean up */
  stop(): Promise<void>;
  onEvent(handler: (event: AIToolEvent) => void): void;
}
```

`start()` hides all provider-specific negotiation. For Claude Code today it starts an
HTTP server. For an MCP-based adapter it would open an MCP client connection. The
`AIToolBridge` calls `start()` and `stop()` — it never knows which kind.

### Bridge (Fan-In)

```typescript
// src/AIToolBridge.ts

export class AIToolBridge {
  private adapters: AIToolAdapter[] = [];

  register(adapter: AIToolAdapter): void { ... }
  startAll(): Promise<void> { ... }
  stopAll(): Promise<void> { ... }

  // Core components subscribe here — they never touch adapters directly
  onEvent(handler: (event: AIToolEvent) => void): void { ... }
}
```

### Adding a New Tool

To add support for a new AI tool, create one file:

```
src/aiToolAdapters/MyNewToolAdapter.ts
```

Implement `AIToolAdapter`, register it in `extension.ts`. Nothing else changes.

---

## Proposed Work

### P1 — `AIToolBridge` + `ClaudeCodeAdapter`

**Priority:** High  
**Effort:** Low–Medium  
**Requires:** Claude Code v2.1+ (HTTP hooks)

#### What

Introduce the adapter layer, then implement the first concrete adapter for Claude Code.

The `ClaudeCodeAdapter`:
- Runs a local HTTP server (port 7379, localhost only)
- Receives Claude's `Stop` and `FileChanged` hooks
- Translates each POST payload into a standard `AIToolEvent`
- Emits the event to `AIToolBridge`

`SessionExporter` and `TelegraphWatcher` subscribe to `AIToolBridge` events — they never
reference Claude Code directly.

#### Hook Configuration (Claude Code)

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "http",
            "url": "http://localhost:7379/hooks/claude/stop",
            "timeout": 10,
            "async": true
          }
        ]
      }
    ]
  }
}
```

`async: true` means the hook fires without blocking Claude's UI — the extension processes
it in the background.

#### New Components

```
src/AIToolBridge.ts                      — fan-in event bus
src/aiToolAdapters/types.ts              — AIToolAdapter, AIToolEvent interfaces
src/aiToolAdapters/ClaudeCodeAdapter.ts  — HTTP server, translates Claude hooks
```

#### Impact

| | Before | After |
|---|---|---|
| Detection latency | 0–5 seconds | ~0ms |
| CPU (idle) | `setInterval` every 5s | Zero — event-driven |
| Accuracy | May miss rapid sessions | Every turn captured |
| Extensibility | Hardcoded to Claude | Add any tool via new adapter |

---

### P2 — Real-Time Telegraph Detection via `FileChanged` Hook

**Priority:** High  
**Effort:** Low (reuses P1 adapter infrastructure)  
**Requires:** Claude Code v2.1+ (HTTP hooks), P1 complete

#### What

Register a `FileChanged` hook watching `*.md` files. When Claude writes a memo to
`.wildwest/telegraph/`, the `ClaudeCodeAdapter` receives the POST, emits a
`file-changed` `AIToolEvent`, and `TelegraphWatcher` scans immediately — no polling.

`TelegraphWatcher` subscribes to `AIToolBridge` events. A future Codex adapter could
emit the same `file-changed` event and `TelegraphWatcher` would respond identically —
no changes required to the watcher itself.

#### Hook Configuration (added to P1's settings block)

```json
{
  "hooks": {
    "Stop": [ /* P1 hook */ ],
    "FileChanged": [
      {
        "matcher": "*.md",
        "hooks": [
          {
            "type": "http",
            "url": "http://localhost:7379/hooks/claude/file-changed",
            "async": true
          }
        ]
      }
    ]
  }
}
```

#### Impact

Closes the Rule 23 timing gap. When Claude writes an outbound memo, the extension
processes the telegraph inbox within milliseconds rather than up to 5 seconds later.

---

### P3 — `@wildwest` Copilot Chat Participant

**Priority:** High  
**Effort:** Low  
**Requires:** VS Code 1.90+, GitHub Copilot Chat extension

#### What

Register the extension as a Copilot chat participant. Users type `@wildwest <command>`
directly in the Copilot panel without leaving chat.

```
User:     @wildwest inbox
Wildwest: 3 memos in telegraph inbox (2 unresolved)
          ⏳ 20260507-1201Z-to-TM(RHk)-from-CD(RSn)--v018-review.md
          ⏳ 20260507-0900Z-to-TM(RHk)-from-S(R)--scope-decision.md
          ✅ 20260506-1800Z-to-TM(RHk)-from-CD(RSn)--registry-sweep-ack.md

User:     @wildwest board
Wildwest: Active branches (2)
          feat/telegraph-delivery-v2 — in-review (PR memo sent 2026-05-07)
          fix/heartbeat-solo-path — open

User:     @wildwest status
Wildwest: Town: wildwest-vscode v0.17.0
          Branch: feat/telegraph-delivery-v2 (3 ahead of main)
          Heartbeat: active (last beat 4m ago)
```

#### New Component: `CopilotParticipant`

```
src/CopilotParticipant.ts
```

Uses `vscode.chat.createChatParticipant('wildwest', handler)`. Reads from `.wildwest/`
files — no new data pipeline needed.

Slash commands to register:
- `/inbox` — telegraph inbox summary
- `/board` — branch lifecycle board
- `/status` — town identity + current state
- `/memo` — recent memo list

#### Impact

Eliminates context switching. Governance queries available directly in Copilot Chat
without leaving the editor.

---

### P4 — `wwMCP` Server

**Priority:** High  
**Effort:** Medium–High  
**Requires:** VS Code extension API 1.90+, MCP SDK

#### What

The extension hosts an **MCP (Model Context Protocol) server** that exposes wildwest
governance state and operations as standardized tools. Any MCP-compatible chat client
(Claude Code, Copilot, Codex, future tools) can connect and access governance data without
change to the extension.

Tools exposed by wwMCP:

- `get_town_status` — town identity, version, branch state, heartbeat
- `get_county_state` — county-level inbox, board, scope decisions (if visible)
- `get_world_status` — territory status, admin decisions (if visible)
- `get_telegraph_inbox` — unresolved memos + recent activity
- `get_board_branches` — branch lifecycle across visible scopes
- `get_memo_details` — full memo content + resolution status
- `list_sessions` — recent exported chat sessions by scope

#### Client Experience

Any chat client that supports MCP (or is updated to support it) automatically gains
access:

```
User (in Claude Code):  "What's in the telegraph inbox?"
Claude:                 [calls get_telegraph_inbox via MCP]
Result:                 3 unresolved memos (2 from CD(RSn), 1 from S(R))

User (in Copilot):      "Show me active branches"
Copilot:                [calls get_board_branches via MCP]
Result:                 2 branches in review, 1 open
```

Once wwMCP exists, all tools gain access. Copilot participant (P3) and wwMCP coexist:
- P3 handles Copilot-specific queries (fast path)
- wwMCP handles everything for non-Copilot tools (extensibility)

#### New Components

```
src/mcp/
  ├── MCPServer.ts              — MCP server host, tool registration
  ├── tools/
  │   ├── townStatus.ts         — get_town_status implementation
  │   ├── countyState.ts        — get_county_state implementation
  │   ├── worldStatus.ts        — get_world_status implementation
  │   ├── telegraphInbox.ts     — get_telegraph_inbox implementation
  │   ├── boardBranches.ts      — get_board_branches implementation
  │   └── ...
  └── types.ts                  — MCP message types, response formats
```

#### Impact

| Capability | Before P3 | After P3 | After P4 |
|---|---|---|---|
| Governance queries in Copilot | No | Yes | Yes |
| Governance queries in Claude Code | No | No | Yes |
| Governance queries in Codex | No | No | Yes |
| Future tools support | No | No | Yes (if tool supports MCP) |
| Single governance model | No | Per-tool | Yes (wwMCP) |

#### Scope Visibility

Tools respect the calling tool's execution context and the user's role:

- `get_town_status` — always available for current town
- `get_county_state` — available if extension is in county scope
- `get_world_status` — available if extension is in world scope (Sheriff role)
- Telegraph + board queries filter results by visible scope

---

## What Is Explicitly Deferred

| Feature | Reason |
|---|---|
| **Codex-specific hook integration** | Low ROI as a P1. Codex can query state via wwMCP (P4). Command hooks can be added post-MCP. |
| **Claude Code Channels** | Research preview (v2.1.80+). Requires `--channels` flag at every `claude` startup. Not suitable for transparent governance tooling until it stabilizes. |
| **Copilot LM API calls** | `vscode.lm` is stateless. P3 + wwMCP provide the governance UI layer; LM calls are a future optimization if needed. |

---

## Scope: Governance Framework (Not Orchestration)

### Current Intent (v0.19–0.20)

The wildwest-vscode extension is a **governance framework**, NOT a chat orchestration layer:

**What we are doing:**
- Observing native AI tool activity (Claude Code, Copilot, Codex) via adapters
- Exporting sessions to markdown transcripts
- Detecting telegraph memos written by AI tools
- Providing lightweight board/inbox queries via `@wildwest` (Copilot participant)
- Enforcing Rule 23 and wildwest protocol compliance

**What we are NOT doing:**
- Replacing or intercepting native chat UIs
- Routing user requests across tools (e.g., "ask Claude for X, Copilot for Y")
- Building a new chat interface

Users stay in their preferred native tools (Claude Code, Copilot Chat). The extension 
observes, logs, and enforces governance — it doesn't mediate communication.

### Future Possibility (v1.0+, if justified)

Nothing about this design prohibits adding orchestration later:

- If cross-tool coordination becomes valuable (e.g., "use Claude Code for deep work, 
  Copilot for quick queries based on governance context"), the adapter layer is already 
  ready to support it.
- A future `Orchestrator` component could sit above `AIToolBridge` and route wildwest 
  requests intelligently.
- The same adapters would work — no redesign required.
- Core components (`SessionExporter`, `TelegraphWatcher`) remain unaffected.

### Why This Order

**Now:** Governance + observability has immediate value and zero adoption friction. 
Users don't learn a new interface.

**Later:** If orchestration ROI becomes clear (audit trails, cost optimization, protocol 
enforcement across tools), the foundation is there. But we're not building it speculatively.

Not painting ourselves into a corner: the adapter abstraction is the no-regret move.

---

## Implementation Sequence

| Step | Component | Description | Depends On |
|---|---|---|---|
| 1 | `AIToolBridge` + `ClaudeCodeAdapter` | Adapter layer + HTTP server (port 7379) | — |
| 2 | `SessionExporter` update | Accept push trigger from bridge; keep polling as fallback | Step 1 |
| 3 | `TelegraphWatcher` update | Accept push trigger from bridge; keep polling as fallback | Step 1 |
| 4 | `TownInit.ts` update | Auto-write hook config to `~/.claude/settings.json` on town init | Steps 1–3 |
| 5 | `CopilotParticipant.ts` | `@wildwest` Copilot Chat participant with slash commands | Steps 1–4 |
| 6 | `MCPServer.ts` + tools | wwMCP server, expose governance as MCP tools | Steps 1–5 (observability + Copilot ready first) |

Step 4 is critical for adoption: if `TownInit` registers the hooks automatically, users
get event-driven capture for free — no manual JSON editing.

Steps 1–5 ship together as v0.19.0 (observability + Copilot participant). Step 6 ships as v0.20.0 once foundation is solid.

---

## Version Impact

| Component | Current Version | Proposed Bump |
|---|---|---|
| Steps 1–5 (observability + adapters + Copilot participant) | v0.17.0 | → v0.19.0 |
| Step 6 (wwMCP server) | — | → v0.20.0 |

Note: v0.18.0 is `feat/telegraph-delivery-v2` (pending merge). Steps 1–5 would be the
next branch after that merges, shipping as v0.19.0 (observability + Copilot integration). wwMCP follows as v0.20.0.

---

## Open Questions for S(R) / CD(RSn)

1. **Port 7379** — acceptable? Conflicts with any known wildwest tooling?
2. **Fallback policy** — if `ClaudeHookReceiver` fails to start (port in use), should the
   extension fall back to polling silently or warn the user?
3. **Hook config ownership** — should `TownInit` write to `~/.claude/settings.json`
   (user-global, affects all projects) or `.claude/settings.json` (project-local)?
   User-global means it works everywhere; project-local means it only fires in this repo.
4. **MCP server scope** (P4 decision) — wwMCP exposes town state by default. Should county/world scope
   visibility be automatic (if extension is running in county/territory context) or
   explicitly configured?

---

**Last Updated:** 2026-05-07T12:44Z  
**Next Step:** Route to CD(RSn) for review or S(R) for scope decision on open questions
