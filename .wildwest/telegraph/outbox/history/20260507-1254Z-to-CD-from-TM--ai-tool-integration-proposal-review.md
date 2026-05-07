# Telegraph Memo

**To:** CD(RSn)  
**From:** TM(RHk).Cpt  
**Date:** 2026-05-07T12:54Z  
**Re:** AI Tool Hook Integration Proposal — scope approval + open questions

---

## Summary

Research and architecture design complete for v0.19–v0.20 feature roadmap.

**Proposal document:** [`docs/20260507-1213Z-proposal-ai-hook-integration.md`](../../docs/20260507-1213Z-proposal-ai-hook-integration.md)

**Research references:**
- [`docs/20260507-1204Z-ai-tool-programmatic-apis.md`](../../docs/20260507-1204Z-ai-tool-programmatic-apis.md) — Claude Code, Codex CLI, GitHub Copilot APIs (comprehensive)
- [`docs/20260507-1145Z-REVIEW-COMPREHENSIVE.md`](../../docs/20260507-1145Z-REVIEW-COMPREHENSIVE.md) — v0.17.0 repo review + v0.18.0 blockers

---

## Proposal Outline (P1–P6)

### v0.19.0 (P1–P5): Event-Driven Observability + Copilot Chat

- **P1** — `AIToolBridge` + `ClaudeCodeAdapter` (adapter layer, HTTP server on port 7379)
- **P2** — Real-time telegraph detection via `FileChanged` hook
- **P3** — `TownInit` auto-write hook config to `~/.claude/settings.json`
- **P4** — `@wildwest` Copilot Chat participant (inbox, board, status queries)
- **P5** — Integration test coverage

### v0.20.0 (P6): Cross-Tool Governance

- **P6** — wwMCP server exposing governance as standardized MCP tools
  - Queries: `get_town_status`, `get_telegraph_inbox`, `get_board_branches`, etc.
  - Works with Claude Code, Copilot, Codex, future MCP clients automatically

---

## Architecture Decisions

1. **Adapter layer** — Core components stay tool-agnostic. Each AI tool gets its own adapter. Scalable to future tools without core changes.

2. **Governance framework, not orchestration** — v0.19–0.20 focus on observability + queries. No AI orchestration (routing requests across tools) — that's a v1.0+ decision if ROI emerges. Foundation is laid.

3. **Service vs. client layer** — Currently integrating at chat client layer (Claude Code hooks, CLI SDKs) because lifecycle events exist there. If AI provider services add streaming session APIs, new adapters slot in without core changes.

---

## Open Questions Requiring Shepherd Decision

1. **Port 7379** — Acceptable? Conflicts with known wildwest tooling?
2. **Fallback policy** — If `ClaudeCodeAdapter` fails to start (port in use), should we fall back to polling silently or warn the user?
3. **Hook config ownership** — Should `TownInit` write to `~/.claude/settings.json` (user-global, works everywhere) or `.claude/settings.json` (project-local)?
4. **MCP server scope visibility** (P6 decision) — Auto-expose County/World state if extension is in that context, or require explicit config?

---

## Implementation Branch

**`feat/ai-tool-integration`** — Ready for review

```
git log:
c739371 docs: research and proposal for AI tool integration (v0.19-v0.20)
5231d86 main — chore(telegraph): CD spec proposal approved for v0.18.0
```

---

## Next Steps

- [ ] **Shepherd review** — scope approval + open questions decision
- [ ] **Route to S(R)** if territory-level impact (e.g., MCP server scope visibility)
- [ ] **Once approved:** Begin P1 implementation on separate branch

---

**Awaiting response. Rule 23: memo sent 2026-05-07T12:54Z.**

TM(RHk).Cpt
