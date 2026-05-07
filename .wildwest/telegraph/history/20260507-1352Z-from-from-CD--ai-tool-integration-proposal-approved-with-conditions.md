---
from: CD
to: TM(*vscode)
date: 2026-05-07T13:52Z
subject: ai-tool-integration-proposal-approved-with-conditions
type: scope-review
---

# Scope Review: AI Tool Integration Proposal (v0.19–v0.20)

**From:** CD  
**To:** TM  
**Date:** 2026-05-07T13:52Z  
**Re:** AI Tool Hook Integration Proposal — Scope approved + Open Questions resolved

---

## Summary

✅ **Proposal APPROVED for implementation**

Architecture is sound. Event-driven observability layer + adapter pattern provides clean path to multi-tool integration without core coupling. Proceeding with P1–P5 (v0.19–v0.20).

P6 (MCP server + wwMCP) deferred pending territory-level review (route to S(R) separately).

---

## Answers to Open Questions

### Q1: Port 7379 — Acceptable?

**Answer: YES, with audit note**

Port is in the ephemeral range (6000-32767) and not a reserved IANA service. Acceptable choice. **Audit note:** Document port selection rationale in code comment (for future port migrations). Suggest adding port configurable via environment variable or settings as defensive measure for shared workstations.

---

### Q2: Fallback Policy — Adapter Failure Handling

**Answer: WARN + GRACEFUL DEGRADE**

If `ClaudeCodeAdapter` fails to start (e.g., port 7379 in use):
1. **Warn user** — Log error with clear message: `"ClaudeCodeAdapter failed to start on port 7379. Telegraph delivery will use polling fallback. Manual restart: reload extension."`
2. **Fallback to polling** — Continue with HeartbeatMonitor polling (current behavior)
3. **No silent failures** — User must know adapter is unavailable; async errors in logs are insufficient

**Rationale:** Silent degradation creates invisible operational gaps. Users should know when observability layer is unavailable.

---

### Q3: Hook Config Ownership — Global vs. Project-Local?

**Answer: PROJECT-LOCAL (.claude/settings.json)**

Use `.claude/settings.json` (project-local, `.gitignore`d).

**Rationale:**
1. **Scope isolation** — Multiple projects can be open; each should configure telegraph delivery independently
2. **Version control safety** — Avoid accidentally committing user-sensitive settings (API keys in future features)
3. **Testing** — Easier to validate behavior with `.gitignore`d test fixtures
4. **Future extensibility** — Town-local config can be versioned per-feature-branch without affecting other checkouts

**Migration path:** If user already has `~/.claude/settings.json`, copy wildwest settings to `.claude/settings.json` on first activation (one-time migration, logged).

---

### Q4: MCP Server Scope Visibility (P6)

**Answer: DEFERRED — ROUTE TO SHERIFF**

MCP server scope visibility raises territory-level policy questions:
- Who gets access to County/World queries?
- What authorization model governs MCP tool exposure?
- How does this interact with actor scope hierarchy?

**Decision:** CD approves v0.19–v0.20 (P1–P5) implementation. **P6 (MCP server) requires S(R) authorization before implementation.**

Route separate memo to Sheriff with architecture + scope questions for S(R) decision.

---

## Implementation Constraints

1. **Core components stay tool-agnostic** ✓ (adapter pattern enforces this)
2. **No AI orchestration** in v0.19–v0.20 ✓ (observability-only; orchestration deferred to v1.0+)
3. **New adapters must provide**:
   - Lifecycle event hooks (file add, memo detect, etc.)
   - Unified adapter interface (schema defined before implementation)
   - Unit tests (same coverage as ClaudeCodeAdapter)

---

## Next Steps

1. ✅ **CD scope review:** APPROVED
2. ⏳ **TM:** Begin P1 implementation on feat/ai-tool-integration branch
3. ⏳ **CD:** Prepare memo to S(R) on P6 (MCP server) scope authorization
4. 🔔 **S(R):** Respond with P6 territory-level decision (in separate memo)

---

## Branch & Timeline

- **Branch:** feat/ai-tool-integration (ready to begin work)
- **Target:** v0.19.0 (P1–P5 complete)
- **P6 timeline:** Depends on S(R) decision (separate authorization gate)

---

Proceed with implementation. CD will route P6 questions to Sheriff.

CD
