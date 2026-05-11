# feat/wire-lifecycle-v2 — Branch Doc

> **Last updated:** 2026-05-11T03:30Z
> **Status:** Active
> **Created:** 2026-05-11 — TM(RHk).Cpt
> **Type:** feature
> **Owner:** TM(RHk)
> **Base branch:** main

---

## Purpose

**Problem:** The current wire status model conflates lifecycle state with per-actor view state, uses a single `archived` status for three different events (sender dismiss, recipient dismiss, system housekeeping), and requires a recipient-local flat/ cache with a forced `status: "sent"` override to make "New" work in the inbox. This is a layered hack, not a design.

**Solution:** Implement a clean wire lifecycle with objective territory-SSOT statuses (`sent → received → read`) and per-actor local overlay fields (`sender_archived_at`, `recipient_archived_at`) that are never written to territory directly. System promotes to `status: archived` only when both parties have dismissed, or a TTL expires.

---

## Scope

### In Scope

- **`FlatWire` schema** — add `received_at`, `read_at`, `sender_archived_at`, `recipient_archived_at` fields; add `received` and `read` as valid status values
- **`WireFactory.createFlatWire()`** — default `status: 'draft'`; draft writes to local `.wildwest/telegraph/flat/` only, not territory
- **`HeartbeatMonitor`** — sender HB: moves `pending` from local outbox → territory as `sent`; recipient HB: detects wires addressed to self at `sent` → updates territory to `received`; both HBs: detect `sender_archived_at` + `recipient_archived_at` both set → promote territory to `archived`
- **`TelegraphPanel`** — drop workspace-local flat/ merge hack; read territory only (+ local for drafts/pending); labels driven by `(status, isInbox)` perspective, not raw status; Archive button writes local overlay only, no territory write; add "Mark Read" action
- **`CHIP_CONFIG`** — update status filter chips to reflect new statuses; inbox chips: `received` (New), `read`, `all`; outbox chips: `draft`, `pending`, `sent`, `received` (Delivered), `read` (Read), `all`
- **`handleArchiveWire()`** — write `sender_archived_at` or `recipient_archived_at` to local copy only; determine which by checking `from`/`to` vs self
- **`handleBulkStatus()`** — remove `archived` as a valid bulk target status
- **`docs/draft-wire-creation-guide.md`** — update lifecycle section
- **`CLAUDE.md`** — update wire lifecycle table

### Out of Scope

- System TTL-based archiving (flagged, deferred)
- Broadcast wire (`to: TM(*vscode)`) multi-recipient archive tracking (deferred)
- Cold storage / `flat/archive/` directory move (deferred)
- Reply wire threading UI (deferred)

---

## Wire Lifecycle Model

### Territory SSOT — objective lifecycle

```
draft     → LOCAL ONLY — .wildwest/telegraph/flat/${wwuid}.json
pending   → LOCAL ONLY — .wildwest/telegraph/outbox/${filename}
sent      → TERRITORY  — ~/wildwest/telegraph/flat/${wwuid}.json  (operator dispatched)
received  → TERRITORY  — status updated by recipient HB on arrival
read      → TERRITORY  — status updated by recipient marking read
archived  → TERRITORY  — system only; both parties dismissed OR TTL
```

### Local per-actor overlay fields (NOT in territory)

```
sender_archived_at:     ISO — sender dismissed from Outbox view
recipient_archived_at:  ISO — recipient dismissed from Inbox view
```

HeartbeatMonitor syncs these fields to territory so the system can detect convergence. Territory wire gains `sender_archived_at` / `recipient_archived_at` as informational fields; neither alone changes `status`.

### Display label mapping (panel)

| status | Outbox label | Inbox label |
|--------|-------------|------------|
| `draft` | Draft | — |
| `pending` | Pending | — |
| `sent` | Sent | — |
| `received` | Delivered | New |
| `read` | Read | Read |
| `archived` | Archived | Archived |

---

## Schema Changes

### `FlatWire` interface additions

```typescript
received_at?:           string;   // ISO — set by recipient HB on arrival
read_at?:               string;   // ISO — set when recipient marks read
sender_archived_at?:    string;   // ISO — local overlay; sender dismissed
recipient_archived_at?: string;   // ISO — local overlay; recipient dismissed
```

Valid `status` values: `draft | pending | sent | received | read | archived`

---

## File Changes

| File | Change |
|------|--------|
| `src/WireFactory.ts` | `CreateWireParams.status` default `'draft'`; add new fields to `FlatWire` interface |
| `src/HeartbeatMonitor.ts` | `updateDestinationFlatWire()`: set `received` not `sent`; add convergence check for archive promotion |
| `src/HeartbeatMonitor.ts` | `updateFlatWireDeliveryStatus()`: set `sent` (not `delivered`) in territory |
| `src/TelegraphPanel.ts` | Drop workspace-local merge; perspective-aware label rendering; Archive → local overlay only; add markRead action |
| `src/WireFactory.ts` | `writeDraftWire()` helper — writes to local flat/ not territory |
| `docs/draft-wire-creation-guide.md` | Update lifecycle section |
| `CLAUDE.md` | Update wire lifecycle table |

---

## Acceptance Criteria

- [ ] `createFlatWire()` without `status` param produces `status: 'draft'`
- [ ] Draft wires written to `.wildwest/telegraph/flat/`, not `~/wildwest/telegraph/flat/`
- [ ] Sender's HB picks up `pending` from outbox → writes to territory as `sent`
- [ ] Recipient's HB detects `sent` wire addressed to self → updates territory to `received`
- [ ] Panel inbox shows `received` wires with label "New"
- [ ] Panel outbox shows `received` wires with label "Delivered"  
- [ ] Panel "Archive" button writes `sender_archived_at` or `recipient_archived_at` to local copy only; no territory write
- [ ] Panel "Mark Read" updates territory `status: read` + `read_at`
- [ ] No workspace-local flat/ merge in `readAllFlatWires()`
- [ ] Existing `delivered` wires in territory remain readable (backwards compat — treat as `received`)

---

## Notes

- `delivered` (legacy) → treat as `received` in panel label logic during transition period
- The local `.wildwest/telegraph/flat/` for drafts/pending is the sender's local PO; it is NOT a recipient cache
- Territory flat/ is the single source of truth for `sent` and beyond
- Archive is a view-layer action only; it never affects the other party's view

---

**Branch:** `feat/wire-lifecycle-v2`
**Target:** `main`
**Reviewer:** CD(RSn)
