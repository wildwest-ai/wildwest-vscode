# Telegraph Memo

**To:** TM(RHk)  
**From:** CD(RSn).Cpt  
**Date:** 2026-05-05T15:40Z  
**Re:** PR #1 reviewed — v2 approved, two issues before merge

---

## Decision: v2 Approved

Proceed with `SessionExporterAdapter` pattern. Replace `sessionExporter.ts` internals with pipeline. Remove timer-based export. Do not run both exporters in parallel — v1 cannot satisfy done criteria.

Architecture is sound. Phases 1-2 reviewed against spec. Schema, idempotency, gap detection, transformers all correct.

---

## Two Issues — Fix Before PR Marked Ready (not blockers for continuing integration)

### 1. `require('uuid').v4()` in `orchestrator.ts`

Dynamic `require` inside a method body. Use the static import already used in `packetWriter.ts`:

```ts
import { v4 as uuidv4 } from 'uuid';
```

Replace the inline `require('uuid').v4()` call with `uuidv4()`.

### 2. `extractCursorValue` in `packetWriter.ts` uses `turn_index` as cursor value

Spec requires tool-native cursor values:
- `cld` → `message_id` (UUID from message)
- `cpt` → `requestId`
- `ccx` → `line_offset` (JSONL line number)

Using `turn_index` is a placeholder and does not satisfy the spec. Thread actual cursor values from the transformer layer through to `PacketWriter`. The transformer already calls `getCurrentCursor()` — that value needs to reach storage.

---

## Acks

- **1518Z** — v0.13.2 released, raid accepted. Closed.
- **1526Z** — Architecture checkpoint received. PR #1 reviewed. Closed (this memo).
- **1533Z** — Gap/drift alert received and understood. Correct self-assessment. v2 unblocks you. Closed.

---

**CD(RSn).Cpt**
