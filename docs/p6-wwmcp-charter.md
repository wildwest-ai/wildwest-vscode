# P6 — wwMCP Server Charter

**Feature:** `wwMCP` — Wild West MCP (Model Context Protocol) Server  
**Version Target:** v0.21.0  
**Authorization:** S(R), 2026-05-07  
**Status:** Chartered — implementation pending

---

## 1. Purpose

`wwMCP` exposes Wild West governance state as a read-only MCP server. External AI tools (Claude Code, future agents) can query governance state without filesystem access, without bypassing the telegraph protocol, and without exceeding their actor scope.

It is the machine-to-machine complement to P7 (`@wildwest` chat participant, the human-facing interface).

---

## 2. Authorization Constraints (from S(R))

| Constraint | Rule |
|---|---|
| **Access** | Explicit opt-in. Actors must be registered in the actor registry before any MCP tool invocation is permitted. Automatic discovery at the protocol level is allowed; tool execution is not. |
| **Scope** | Determined at connection time by which workspace/tool opens the connection. Not per-query. |
| **Writes** | Read-only through v0.21. Write authority deferred to v1.0+ after auth model is proven. |

### Scope at Connection Time

| Connecting actor | Scope granted | Visible data |
|---|---|---|
| TM instance (town workspace) | `town` | Town state only |
| CD instance (county workspace) | `county` | County + all towns in county |
| S instance (territory workspace) | `territory` | Full world |

---

## 3. Architecture

### 3.1 Transport

Standard MCP over stdio (primary). HTTP SSE transport optional for future remote use — not in v0.21.

### 3.2 Server Lifecycle

`wwMCP` runs as a child process spawned by the extension on activation (if enabled). The extension manages the process lifecycle:
- Spawn on `activate()` (if `wildwest.mcp.enabled === true`)
- Graceful shutdown on `deactivate()`
- Port/pipe conflict: warn via `vscode.window.showWarningMessage`, degrade gracefully (no crash)

### 3.3 Registration Check

On each tool invocation, the server resolves the caller's identity from the MCP connection context and checks the actor registry. If the actor is not registered → return `403 Unauthorized` (MCP error response). No state is returned.

---

## 4. Tool Surface (v0.21 — Read-Only)

### `wildwest_status`
Returns town/county identity, heartbeat state, last beat timestamp.

**Input:** none  
**Output:**
```json
{
  "alias": "wildwest-vscode",
  "scope": "town",
  "wwuid": "83b09a8d-...",
  "lastBeat": "2026-05-07T15:14:30.904Z",
  "state": "alive"
}
```

### `wildwest_inbox`
Returns unprocessed memos from the actor's inbox (scope-filtered).

**Input:** `{ "limit": number (optional, default 20) }`  
**Output:**
```json
{
  "memos": [
    { "filename": "20260507-1507Z-...", "subject": "...", "from": "CD", "date": "2026-05-07T15:07Z" }
  ],
  "total": 1
}
```

### `wildwest_board`
Returns tracked branches from `.wildwest/board/branches/`.

**Input:** `{ "state": "open|all (optional, default open)" }`  
**Output:**
```json
{
  "branches": [
    { "branch": "feat/ai-tool-integration", "state": "open", "actor": "TM(wildwest-vscode)" }
  ]
}
```

### `wildwest_telegraph_check`
Returns counts for all 4 telegraph directories: inbox, outbox, history, and dead-letter (! files).

**Input:** none  
**Output:**
```json
{
  "inbox": 0,
  "outbox": 1,
  "history": 12,
  "deadLetter": 0
}
```

---

## 5. Actor Registry Integration

The actor registry (`.wildwest/registry.json` → `actors` array, or a dedicated `actors.json`) maps actor identities to scopes. Shape TBD pending S(R) identity block decision (open P1).

For v0.21, registration check is permissive if the registry has no `actors` array — log a warning but allow access. This avoids blocking all MCP use until the registry schema is finalized.

---

## 6. File Layout

```
src/
  mcp/
    wwMCPServer.ts       — MCP server entry, tool registration, scope resolution
    wwMCPTools.ts        — Tool handler implementations (wildwest_status, _inbox, _board, _telegraph_check)
    wwMCPAuth.ts         — Actor registration check
    types.ts             — Shared MCP types
```

Wired into `extension.ts` via `registerMCPServer(context, outputChannel, heartbeatMonitor)`.

---

## 7. Configuration

```json
{
  "wildwest.mcp.enabled": false,
  "wildwest.mcp.transport": "stdio"
}
```

Disabled by default. Actor must explicitly enable.

---

## 8. Out of Scope for v0.21

- Write tools (send memo, archive, board mutations)
- HTTP SSE transport
- Per-query scope override
- Multi-county federation queries
- Remote MCP (network transport)

These are deferred to v1.0+ or later charters.

---

## 9. Relationship to Other Features

| Feature | Role |
|---|---|
| **P6 wwMCP** (this) | Machine-to-machine; serves external AI tools; read-only |
| **P7 chat participant** | Human-to-extension; serves actor in Copilot window; action-capable via commands |
| **AIToolBridge / ClaudeCodeAdapter** | Inbound events from AI tools → extension; not outbound queries |

P6 and P7 are complementary. P6 answers queries from tools. P7 answers queries from humans.

---

## 10. Open Questions

| Question | Status |
|---|---|
| Actor registry shape (`actors` array in registry.json vs dedicated file) | Blocked on S(R) identity block decision (P1) |
| MCP SDK — `@modelcontextprotocol/sdk` or hand-rolled? | Decision needed before impl |
| Stdio vs named pipe for local IPC | Stdio preferred; confirm before impl |

---

**Charter Author:** TM(wildwest-vscode)  
**Charter Date:** 2026-05-07  
**Next Step:** Resolve open questions, begin `src/mcp/` scaffold
