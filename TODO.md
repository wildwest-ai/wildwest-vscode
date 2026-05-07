# TODO — wildwest-vscode

> **Last updated:** 2026-05-07T12:46Z

---

## P1–P6: AI Tool Hook Integration Proposal ✓ drafted 2026-05-07

**Proposal:** [docs/20260507-1213Z-proposal-ai-hook-integration.md](./docs/20260507-1213Z-proposal-ai-hook-integration.md)

**Problem:** Extension polls every 5s; telegraph detection lags; no cross-tool governance interface.

**Solution:** Adapter layer + event-driven observability + Copilot Chat queries + wwMCP server.

### Implementation Sequence

**v0.19.0 (P1–P5):**
- [ ] **P1** — `AIToolBridge` + `ClaudeCodeAdapter` (HTTP server, port 7379)
- [ ] **P2** — `SessionExporter` + `TelegraphWatcher` accept push triggers from adapter
- [ ] **P3** — `TownInit` auto-write hook config to `~/.claude/settings.json`
- [ ] **P4** — `CopilotParticipant` — `@wildwest` queries in Copilot Chat
- [ ] **P5** — Test coverage + integration test for full flow

**v0.20.0 (P6):**
- [ ] **P6** — `MCPServer` + wwMCP tools (exposes governance to any MCP client)

**Blocking decision:**
- [ ] **S(R) or CD(RSn) scope approval** — AI tool integration is in-scope for TM(RHk)? (Check open questions in proposal)

**Open questions (require shepherd decision):**
1. Port 7379 acceptable? Conflicts with known wildwest tooling?
2. Fallback policy if ClaudeCodeAdapter fails to start?
3. Hook config ownership (user-global vs project-local)?
4. MCP server scope visibility (auto or explicit)?

---

## Comprehensive review follow-up — 2026-05-07

Source: [docs/REVIEW-COMPREHENSIVE-20260507-1145Z.md](./docs/REVIEW-COMPREHENSIVE-20260507-1145Z.md)

### Release blockers

- [ ] **Startup safety:** remove `process.exit(1)` from `BatchChatConverter.run()` and make an empty raw session directory a no-op when called from the extension.
- [ ] **Telegraph inbox processing:** update `TelegraphInbox` to scan `.wildwest/telegraph/inbox/` and accept delivered filenames shaped like `YYYYMMDD-HHMMZ-to-...`.
- [ ] **Telegraph v2 send/delivery contract:** update `telegraphSend` to use role-only or role-pattern addressing and stop hard-coding `from: TM(RHk).Cpt`.
- [ ] **Old-format transition:** either fully parse `CD(RSn).Cpt` during the v0.18 transition or reject it with a clear error; fix the deprecated-format detector.
- [ ] **Role routing:** resolve the `TM` county/town ambiguity so `TM(*vscode)` routes to town scope as documented.
- [ ] **Verification gate:** get `npm test` green again; lint currently fails before Jest runs, and direct Jest has 4 failing tests.

### High-value follow-ups

- [ ] **Custom export path:** initialize `PipelineAdapter` from the effective `wildwest.exportPath` instead of hard-coded `~/wildwest/sessions/{gitUsername}`.
- [ ] **Shell-safe git config:** replace interpolated `execSync(\`git config user.name "${username}"\`)` with argument-safe execution.
- [ ] **VSIX hygiene:** update `.vscodeignore` so `.wildwest/**`, `src/**`, `__tests__/**`, and other non-runtime files are not packaged.
- [ ] **Status bar disposal:** store and dispose configuration listeners, workspace listeners, and the refresh interval in `StatusBarManager`.
- [ ] **Production-backed tests:** stop duplicating telegraph delivery logic inside tests; exercise production delivery/inbox code paths.

---

## staged/ — continuous incremental sync (fixed v0.7.1)

`staged/` is the interim MCP proxy. The v0.6.0 auto-sync ran once at startup only — active
sessions updated after startup were never re-converted. Spotted when reading TM session 54f60505:
raw/ had the latest content (12:36) but staged/ was stale (synced at 11:56).

**Fix (v0.7.1):** fire `batchConvertSessions(true)` at the end of each `checkAllChatSessions()`
poll cycle when activity is detected. `BatchChatConverter.isAlreadyConverted()` already uses mtime
checks — only changed files are re-converted. staged/ now lags raw/ by at most one 5s poll cycle.

---

## vsix — output to build/ only (fixed v0.7.1)

Root vsix files (0.5.5, 0.6.0, 0.7.0) were left in repo root — `.gitignore` correctly ignores
root `*.vsix` and tracks only `build/*.vsix`. Root strays moved to `build/` in v0.7.1.
`npm run package` uses `--out build/` — always use it, never bare `vsce package`.

---

## MCP integration — future

Migrate governance artifacts from local `.wildwest/` files to an MCP server. Governance capabilities become MCP tools callable by any actor regardless of editor or channel.

- [ ] **MCP server** — expose `sendMessage`, `readTelegraph`, `reportHeartbeat`, `listWorktrees`, `getSoloTier` as MCP tools
- [ ] **wildwest-vscode as MCP host** — bridge VSCode UI + file watching to the MCP transport layer
- [ ] **`.wildwest/` shrinks to runtime only** — `telegraph/`, `scripts/`, `docs/` move server-side; only `worktrees/` remains locally (fully gitignored)
- [ ] **Actor-agnostic** — Claude Code, Copilot, Codex all call the same MCP tools; no file-convention assumptions

Out of scope until governance file layer is stable.

---

## Command palette — category split

Split the flat `Wild West` category into two groups so the palette is self-organizing:

- [ ] **`Wild West: Sessions`** — Start/Stop Watcher, Export Now, Batch Convert, Convert to Markdown, Generate Index
- [ ] **`Wild West: Governance`** — Start/Stop Heartbeat, View Telegraph, Solo Mode Report

Change is purely in `package.json` `contributes.commands[*].category` — no code changes.

---

## Status bar — Wild West features

### Medium value, more effort

- [ ] **Telegraph unread count** — `$(mail) N` badge when non-system files exist in `.wildwest/telegraph/`. `TelegraphWatcher` already watches the dir; count and badge.
- [ ] **Last beat age** — show `N min ago` in the heartbeat tooltip (or inline). `.last-beat` mtime is already read in `checkLiveness()`; format the age as a human string. Catches stale-but-not-yet-expired heartbeats early.

---

## Backlog — v0.15.x

- [ ] **`wildwest.telegraphStatus` command (P4)** — Query and display current telegraph status (inbox count, unresolved memos, compliance state). Deferred pending session-open/close protocol maturation. Adopted in 0254Z decisions memo 2026-05-05.
