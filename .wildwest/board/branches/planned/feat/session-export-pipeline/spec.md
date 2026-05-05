# Session Export Spec

**Version:** 1.0.0-draft  
**Created:** 2026-05-05T14:27Z  
**Scope:** territory  
**Status:** draft — pending TM implementation

---

## Purpose

Defines the normalized session export pipeline for the Wild West territory. Captures AI tool sessions from any device, transforms them into a tool-agnostic packet stream, and persists them locally and via wwMCP for cross-device continuity, context restoration, and territory governance audit.

---

## Design Principles

1. **Packets are the canonical record.** Raw files are ephemeral local buffers. The packet stream is the audit trail.
2. **Normalized schema enables cross-tool context.** Any tool can read any session. Tool boundaries are invisible to context restoration.
3. **Local-first.** The full pipeline operates on a single device with no external dependencies. wwMCP sync is optional.
4. **Device agnostic when connected.** With wwMCP, sessions follow the actor, not the machine.
5. **Idempotent processing.** Every operation is safe to replay.
6. **Raw files never leave the local machine.** Only normalized packets sync to remote.

---

## Supported Tools

| Code | Tool |
|---|---|
| `cld` | Claude Code |
| `cpt` | GitHub Copilot |
| `ccx` | ChatGPT Codex |

---

## Directory Structure

```
sessions/
  raw/                          ← local capture buffer (tool-native, never synced)
    cld/                        ← one JSON file per session (<tool_sid>.json)
    cpt/                        ← one JSON file per session (<tool_sid>.json)
    ccx/                        ← one JSONL file per session (rollout-<ts>-<tool_sid>.jsonl)
  staged/
    packets/                    ← delta packets (audit trail + MCP sync payload)
    storage/
      sessions/                 ← normalized accumulated session records
      index.json                ← queryable session manifest
```

`raw/` is retained until all turns are confirmed in storage. Once a session is fully packeted and synced, `raw/` files may be pruned per the territory retention policy.

---

## Session Identity

### `wwsid`

Every session is assigned a **wildwest session ID** (`wwsid`) — a plain UUID (v5), deterministically derived from the tool code and tool-native session ID.

```
wwsid = UUIDv5(WW_SESSION_NAMESPACE, tool + ":" + tool_sid)
```

**WW_SESSION_NAMESPACE:** `f47ac10b-58cc-4372-a567-0e02b2c3d479` *(fixed, never changes)*

No mapping file required. Same input always produces the same `wwsid`. Idempotent across runs and devices.

### `device_id`

UUIDv5 derived from the machine's hardware UUID or hostname. Identifies which device produced a packet.

```
device_id = UUIDv5(WW_DEVICE_NAMESPACE, hostname_or_hw_uuid)
```

**WW_DEVICE_NAMESPACE:** `6ba7b810-9dad-11d1-80b4-00c04fd430c8` *(fixed, never changes)*

---

## Packet Schema

**File:** `staged/packets/<wwsid>-<seq_from_padded>-<seq_to_padded>.json`  
**Filename padding:** 8-digit zero-padded integers — e.g. `<wwsid>-00000042-00000045.json`

```json
{
  "schema_version": "1",
  "packet_id": "<uuid-v4>",
  "wwsid": "<uuid-v5>",
  "tool": "cld",
  "tool_sid": "<tool-native-session-id>",
  "actor": "reneyap",
  "device_id": "<uuid-v5>",
  "seq_from": 42,
  "seq_to": 45,
  "created_at": "2026-05-04T22:14:03Z",
  "closed": false,
  "turns": [
    {
      "turn_index": 42,
      "role": "user",
      "content": "tell me what you remember?",
      "parts": [
        { "kind": "text", "content": "tell me what you remember?" }
      ],
      "meta": {},
      "timestamp": "2026-05-04T22:14:01Z"
    },
    {
      "turn_index": 43,
      "role": "assistant",
      "content": "Here is my answer...",
      "parts": [
        { "kind": "thinking", "content": "...", "thinking_id": "abc123" },
        { "kind": "text",     "content": "Here is my answer..." }
      ],
      "meta": {
        "model": "claude-sonnet-4-6",
        "elapsed_ms": 2340,
        "completion_tokens": 142
      },
      "timestamp": "2026-05-04T22:14:03Z"
    }
  ]
}
```

### Turn fields

| Field | Required | Description |
|---|---|---|
| `turn_index` | yes | Zero-based position in session. Monotonically increasing. Idempotency key with `wwsid`. |
| `role` | yes | `user` \| `assistant` |
| `content` | yes | Pre-joined string of all `kind: text` parts. Convenience field for simple consumers. |
| `parts` | yes | Ordered array of content parts. Authoritative. |
| `meta` | yes | Per-turn metadata. Empty object `{}` if none available. |
| `timestamp` | yes | ISO 8601 UTC. |

### Part kinds

| Kind | Description |
|---|---|
| `text` | Plain text content |
| `thinking` | Chain-of-thought / reasoning (CoT). Preserved with `thinking_id` when available. |
| `tool_use` | Tool invocation |
| `tool_result` | Tool response |
| `meta` | Tool-specific noise absorbed by transform layer. Never reaches storage turns. |

### Meta fields (per turn, all optional)

| Field | Description |
|---|---|
| `model` | Model identifier (e.g. `claude-sonnet-4-6`, `gpt-5.2-codex`) |
| `elapsed_ms` | Time to generate response |
| `completion_tokens` | Token count for response |

### Session close packet

When a session closes, the final packet carries `"closed": true`. Storage adds `closed_at` to the session record and index entry on receipt.

---

## Session Record Schema

**File:** `staged/storage/sessions/<wwsid>.json`

```json
{
  "schema_version": "1",
  "wwsid": "<uuid-v5>",
  "tool": "cld",
  "tool_sid": "<tool-native-session-id>",
  "actor": "reneyap",
  "device_id": "<uuid-v5>",
  "session_type": "chat",
  "project_path": "/Users/reneyap/wildwest",
  "created_at": "2026-05-04T21:11:44Z",
  "last_turn_at": "2026-05-04T23:10:13Z",
  "closed_at": null,
  "cursor": {
    "type": "message_id",
    "value": "e8ebe0ee-8978-4b4f-88fb-75a33c1ac2f1"
  },
  "turn_count": 52,
  "turns": []
}
```

`turns` is the accumulated full history, built by applying packets in order.

### Cursor types by tool

| `tool` | `cursor.type` | `cursor.value` |
|---|---|---|
| `cld` | `message_id` | Last processed `message.id` (UUID) |
| `cpt` | `request_id` | Last processed `requestId` |
| `ccx` | `line_offset` | Last processed JSONL line number |

---

## Index Schema

**File:** `staged/storage/index.json`

```json
{
  "schema_version": "1",
  "updated_at": "2026-05-05T13:01:00Z",
  "sessions": [
    {
      "wwsid": "<uuid-v5>",
      "tool": "cld",
      "tool_sid": "<tool-native-session-id>",
      "actor": "reneyap",
      "device_id": "<uuid-v5>",
      "session_type": "chat",
      "project_path": "/Users/reneyap/wildwest",
      "created_at": "2026-05-04T21:11:44Z",
      "last_turn_at": "2026-05-04T23:10:13Z",
      "closed_at": null,
      "turn_count": 52
    }
  ]
}
```

Index entries contain no turns. Fast lookup without loading session content.

---

## Processing Rules

### Exporter trigger
- **Turn completion** — packet emitted after each assistant response completes
- **Session close** — final packet emitted with `"closed": true`
- Timer-based export is explicitly prohibited (produces redundant full-session snapshots)

### Idempotency
Storage MUST treat `(wwsid, turn_index)` as a unique key. Applying a packet that contains already-stored turn indexes MUST be a no-op. Existing turns are never overwritten.

### Gap detection
`seq_from` of packet N+1 MUST equal `seq_to` of packet N plus one. A gap indicates data loss. Storage MUST flag and reject out-of-sequence packets rather than silently accepting them.

### Index update timing
Index entry is upserted on every packet application. `last_turn_at` and `turn_count` reflect the current packet. `closed_at` is set when `"closed": true` packet is received.

### Multi-part turn normalization
Tool responses containing multiple content parts (e.g. Copilot `thinking` + `text`) are split into separate turns at the transform layer. `turn_index` is assigned sequentially. The tool's native request count does not map 1:1 to `turn_index`.

### Meta absorption
Tool-specific noise events (`mcpServersStarting`, `turn_context`, `session_meta`) are consumed by the transform layer. Structured fields (model, cwd, version) are lifted into session record fields. Remainder is discarded. Meta events never appear as turns in storage.

---

## Operating Modes

### Local mode (default)

No external dependencies. Full pipeline runs on a single device.

```
raw/ → transform → packets/ → storage/
```

Audit trail is local. Sessions are not accessible from other devices.

### Connected mode (wwMCP)

When wwMCP is configured, packets, session records, and the index sync to the territory MCP server. Raw files are never synced.

```
raw/ → transform → packets/ → storage/
                       ↓
                     wwMCP  ←→  any device / any tool
```

wwMCP is the **actor-scoped, device-agnostic, tool-normalized session packet store for the territory.**

### Context restoration protocol (connected mode)

```
1. New session opens on any device / any tool
2. Query wwMCP: sessions(actor, project_path, limit=N)
3. Pull packet stream for matching sessions
4. Reconstruct turn history from normalized packets
5. Inject as context — AI resumes with full history, no cold start
```

Because all tools produce the same normalized turn schema, context restored from a `cpt` session is readable by a `cld` session and vice versa. Tool and device boundaries are transparent to the restored context.

### Governance (connected mode)

Territory actors (G, RA) may pull any actor's session stream from wwMCP across all devices and tools. The packet sequence provides a complete, sequenced, gap-detectable audit trail without requiring access to individual machines or raw files.

---

## Out of Scope (this version)

- `copilot-edits` — edit sessions (non-chat). Separate spec required.
- wwMCP server implementation
- Context injection protocol (implementation detail for each tool's adapter)
- Remote retention and pruning policy
- Encryption at rest / in transit
