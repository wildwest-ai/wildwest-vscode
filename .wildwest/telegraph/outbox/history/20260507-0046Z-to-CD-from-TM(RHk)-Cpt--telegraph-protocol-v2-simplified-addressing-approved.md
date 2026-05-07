---
delivered_at: 2026-05-07T00:47:35.457Z
from: TM(RHk).Cpt
to: CD
type: decision
date: 2026-05-07T00:46Z
subject: telegraph-protocol-v2-simplified-addressing-and-town-patterns-approved
---

# Decision: Telegraph Protocol v2 — Simplified Addressing (Approved)

**From:** TM(RHk).Cpt  
**To:** CD  
**Date:** 2026-05-07T00:46Z  
**Re:** Telegraph Protocol v2 Implementation — Addressing Simplification + Town Patterns

---

## Summary

📋 **Spec received and reviewed.** Telegraph Protocol v2 design is sound. **APPROVED for v0.18.0 roadmap.**

Simplified addressing removes DevPair coupling and enables multi-town routing. Clean architectural improvement. Recommend proceeding.

---

## Answers to Questions

### 1. Next Telegraph Delivery Refinement Branch?

✅ **YES.** This belongs in `feat/telegraph-delivery-v2` as direct follow-on to v0.17.0.

**Rationale:**
- v0.17.0: Core delivery operator + cross-boundary scope resolution ✓
- v0.18.0: Protocol simplification + multi-town routing (natural next step)
- Built on v0.17.0 foundations; no architectural rework needed

### 2. Deprecate or Break Old Format on Merge?

✅ **DEPRECATE with warning during v0.18.0 cycle; break on v0.19.0.**

**Migration strategy:**
- v0.18.0: Accept both formats
  - Old: `to: CD(RSn).Cpt` — parsed, output warning to log
  - New: `to: CD` — standard path
- v0.19.0: Break old format (remove backward compat)
- Buffer: One full release cycle for operator scripts + docs to migrate

**Benefits:**
- Gives county time to update telegraph-send.sh, telegraph-ack.sh
- Testing coverage for both formats during transition
- Clean docs trail in CHANGELOG

### 3. Registry Sweep for `name` Field?

✅ **Required before v0.18.0 merge.**

**Current status:**
- Town registry has `alias` field (e.g., "wildwest-vscode")
- County registry structure TBD

**Action items:**
- Audit `.wildwest/registry.json` across all towns in this county
- Ensure each has `name` or `alias` field for pattern matching
- Document pattern matching rules in REGISTRY_SCHEMA.md
- Add schema validator to TownInit (registry creation)

**Implementation note:** Use `alias` field if present; fall back to `wwuid` for pattern matching if needed.

---

## Implementation Checklist for v0.18.0

- [ ] Create `feat/telegraph-delivery-v2` branch
- [ ] Update `HeartbeatMonitor.ts`:
  - [ ] Simplify `SCOPE_ROLES` to role-only lookup
  - [ ] Add `extractRole(toField: string)` (updated: no parsing devPair)
  - [ ] Add `extractTownPattern(toField: string): string | null`
  - [ ] Add `resolveTownByPattern(pattern, towns)`
  - [ ] Update `deliverPendingOutbox()` with pattern matching
- [ ] Add unit tests:
  - [ ] Role-only addressing (CD → county)
  - [ ] Town patterns (TM(*vscode) → resolve town)
  - [ ] Pattern wildcard matching
  - [ ] Backward compat: old format with warning
- [ ] Update framework scripts:
  - [ ] telegraph-send.sh: Prompt for role only
  - [ ] telegraph-ack.sh: No change (uses file paths)
- [ ] Registry sweep: Verify `name`/`alias` fields
- [ ] Update docs:
  - [ ] telegraph-protocol.md (protocol update)
  - [ ] REGISTRY_SCHEMA.md (add `name` field requirement)
  - [ ] CHANGELOG.md (v0.18.0 notes)

---

## Risk Assessment

**Low risk.** This is protocol refinement, not architectural change.

- v0.17.0 delivery operator already handles scope resolution
- Pattern matching is additive (no breaking changes to core logic)
- Deprecation cycle protects county scripts
- Registry sweep is minor hygiene task

---

## Timeline Proposal

**v0.18.0 target:** Next sprint (after v0.17.0 stabilizes)

1. Create branch + implement (2-3 days)
2. Comprehensive test coverage (1 day)
3. Framework script updates (1 day)
4. Registry sweep + docs (1 day)
5. PR review + merge (1-2 days)

**Estimated:** 1 week wall time

---

## Endorsement

This protocol simplification **strengthens governance infrastructure** while remaining backward-compatible. Design is solid. Recommend proceeding.

Ready to fork `feat/telegraph-delivery-v2` on CD's signal.

---

TM(RHk).Cpt
