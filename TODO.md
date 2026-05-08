# TODO — wildwest-vscode

> **Last updated:** 2026-05-08T12:56Z
> **Review source:** `docs/20260507-2253Z-repo-review-findings.md`

---

## P1 — Blocking (next release)

- [x] **Telegraph inbox v2 contract** — `TelegraphInbox` scans the telegraph root and only accepts `to-*`; it must scan `.wildwest/telegraph/inbox/` and accept `YYYYMMDD-HHMMZ-to-...` delivered filenames
- [x] **Ack delivery path** — `telegraphAck` writes ack files to the telegraph root; all outbound memos/acks must be written to `outbox/` so delivery can route them
- [x] **Heartbeat flagged state** — `beatTown()` treats normal `inbox/` and `outbox/` directories as flags; compute flagged state from unresolved memo files instead
- [x] **Custom export path** — `PipelineAdapter` hard-codes `~/wildwest/sessions/{gitUsername}`; wire it to `wildwest.exportPath`
- [x] **Extension lifecycle cleanup** — `SessionExporter.dispose()` does not clear polling; `deactivate()` does not await async shutdown
- [x] **Command contributions** — registered commands like `startHeartbeat`, `stopHeartbeat`, `showStatus`, `openExportFolder`, `viewOutputLog`, and `openSettings` are not contributed in `package.json`
- [x] **Git/worktree command safety** — replace shell-interpolated git calls with argument arrays and avoid branch checkout during `initTown`
- [x] **Self-addressed telegraph delivery** — same-scope recipients now resolve to the current town path; self-addressed outbox memos are delivered into local `inbox/` and archived in `outbox/history/`
- [ ] **First-run consent** — startup currently scans AI session stores by default; add explicit provider consent/source scoping before broad export
- [ ] **Identity block shape decision** — S(R) call needed (affects registry schema)
- [ ] **`scope: "town"` field** — Add to `.wildwest/registry.json` for all scopes
- [ ] **TownInit.ts fix** — Write `scope` field on registry creation
- [ ] **SoloModeController.hasBranchDoc()** — Check correct path (stale reference)

## P2 — Nice-to-Have

- [x] **TelegraphService abstraction** — centralize address parsing, filename generation, inbox/outbox paths, ack generation, archiving, delivery status (v0.25.10)
- [x] **Production-code telegraph tests** — exercise production delivery/inbox code paths (v0.25.10)
- [x] **Wild West Doctor command** — validate registry, worktree, outbox/inbox dirs, actor role, export path, MCP status, hook port, stale heartbeat state (v0.25.9)
- [x] **Side panel** — Inbox, Outbox, History, Board, Receipts, Heartbeat, Actor in one VS Code view (v0.28.0)
- [x] **Memo action UX** — rich header, body preview, Reply action (v0.27.0)
- [x] **Delivery receipts** — track pending, delivered, failed, acknowledged, blocked per memo (v0.29.0)
- [x] **Privacy mode** — redact paths, env strings, secret patterns before staged export (v0.25.13)
- [x] **CLAUDE.md template** — auto-scaffold on `initTown` (v0.26.0)
- [x] **Registry validator** — lint `.wildwest/registry.json` for schema compliance (v0.25.12)
- [x] **Release artifact hygiene** — VSIX files excluded from git; use GitHub Releases or CI artifacts (v0.25.11)
