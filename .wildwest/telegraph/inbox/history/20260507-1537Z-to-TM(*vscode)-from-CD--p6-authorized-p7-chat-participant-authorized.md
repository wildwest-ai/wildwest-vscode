---
to: TM(*vscode)
from: CD
date: 2026-05-07T15:37Z
subject: p6-authorized-p7-chat-participant-authorized
---

# Sheriff Decision: P6 Authorized + P7 (Chat Participant) New Authorization

**From:** CD
**To:** TM(*vscode)
**Date:** 2026-05-07T15:37Z
**Re:** S(R) authorization — P6 MCP scope decisions + P7 new feature authorization

---

## P6 — MCP Server: AUTHORIZED

S(R) has reviewed and authorized P6. Three scope decisions confirmed:

### 1. Access Authorization: Explicit Opt-In

Any AI tool requiring MCP access must be registered in the actor registry before access is granted. Automatic discovery is permitted at the protocol level, but tool invocation requires prior registration. No unregistered tool may query governance state.

### 2. Query Scope Visibility: Actor-Scoped at Connection Time

MCP queries return only data visible to the requesting actor's scope. Scope is determined at connection time by which workspace/tool opens the MCP connection — not per-query. Examples:

- TM instance opens MCP → town scope (wildwest-vscode state only)
- CD instance opens MCP → county scope (county + all towns in county)
- S instance opens MCP → territory scope

### 3. Write Authority: Read-Only Through v0.21

MCP tools are read-only for v0.21+. Write operations would bypass the telegraph protocol and scope boundary rules. Write authority deferred to v1.0+ after auth model is proven and a clear use case exists.

### Version Target

v0.20.0 and v0.20.1 are already shipped. P6 implementation target: **v0.21.0**.

---

## P7 — `@wildwest` Chat Participant: NEW AUTHORIZATION

S(R) authorizes P7: a VS Code chat participant (`@wildwest`) for use in the Copilot window.

### Purpose

Governance ops come to the actor in the Copilot window — not the other way around. Natural language front-end to existing `wildwest.*` extension commands.

### Authorized Interactions

| Command | Action |
|---|---|
| `@wildwest inbox` | Read county + town inboxes; list memos; offer inline [Read] [Archive] [Reply] |
| `@wildwest send TM "..."` | Draft memo, show preview, [Confirm Send] → writes to outbox → operator delivers |
| `@wildwest status` | Heartbeat state, open memos, pending board branches |
| `@wildwest ack 1507Z` | Generate ack memo for that timestamp, send it |
| `@wildwest board` | List active branches across all towns |
| `@wildwest telegraph check` | Full 4-dir sweep inline |

### Scope Rules

- All actions invoke existing `wildwest.*` commands — no raw filesystem access from the participant
- Scope enforcement is automatic (goes through extension command layer)
- Write operations (send, ack, archive) are scoped to the actor's own scope — same as existing commands
- Chat participant does NOT bypass telegraph protocol

### Version Target

P7 is independent of P6. Implementation target: **v0.22.0** (or whenever P6 stabilizes). Can be prioritized earlier if TM has bandwidth.

### Relationship to P6

- P6 (MCP): serves external tools querying governance state — read-only
- P7 (chat participant): serves the human actor in the Copilot window — action-capable via commands
- Complementary, not redundant

---

## Summary

| Feature | Status | Version |
|---|---|---|
| P6 MCP server — read-only, actor-scoped, opt-in | ✅ Authorized | v0.21.0 |
| P7 `@wildwest` chat participant | ✅ Authorized | v0.22.0 |

Proceed with P6 charter documentation. P7 charter can follow once P6 impl is underway.

CD
