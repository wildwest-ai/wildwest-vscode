# TODO — wildwest-vscode

> **Last updated:** 2026-05-07T22:53Z
> **Review source:** `docs/20260507-2253Z-repo-review-findings.md`

---

## P1 — Blocking (next release)

- [ ] **Telegraph inbox v2 contract** — `TelegraphInbox` scans the telegraph root and only accepts `to-*`; it must scan `.wildwest/telegraph/inbox/` and accept `YYYYMMDD-HHMMZ-to-...` delivered filenames
- [ ] **Ack delivery path** — `telegraphAck` writes ack files to the telegraph root; all outbound memos/acks must be written to `outbox/` so delivery can route them
- [ ] **Heartbeat flagged state** — `beatTown()` treats normal `inbox/` and `outbox/` directories as flags; compute flagged state from unresolved memo files instead
- [ ] **Custom export path** — `PipelineAdapter` hard-codes `~/wildwest/sessions/{gitUsername}`; wire it to `wildwest.exportPath`
- [ ] **Extension lifecycle cleanup** — `SessionExporter.dispose()` does not clear polling; `deactivate()` does not await async shutdown
- [ ] **Command contributions** — registered commands like `startHeartbeat`, `stopHeartbeat`, `showStatus`, `openExportFolder`, `viewOutputLog`, and `openSettings` are not contributed in `package.json`
- [ ] **Git/worktree command safety** — replace shell-interpolated git calls with argument arrays and avoid branch checkout during `initTown`
- [ ] **First-run consent** — startup currently scans AI session stores by default; add explicit provider consent/source scoping before broad export
- [ ] **Identity block shape decision** — S(R) call needed (affects registry schema)
- [ ] **`scope: "town"` field** — Add to `.wildwest/registry.json` for all scopes
- [ ] **TownInit.ts fix** — Write `scope` field on registry creation
- [ ] **SoloModeController.hasBranchDoc()** — Check correct path (stale reference)

## P2 — Nice-to-Have

- [ ] **TelegraphService abstraction** — centralize address parsing, filename generation, inbox/outbox paths, ack generation, archiving, and delivery status
- [ ] **Production-code telegraph tests** — replace copied/simplified test implementations with tests that import and exercise production delivery/inbox code
- [ ] **Wild West Doctor command** — validate registry, worktree, outbox/inbox dirs, actor role, export path, MCP status, hook port, and stale heartbeat state
- [ ] **Side panel** — show Inbox, Outbox, History, Board, Heartbeat, and Actor state in one VS Code view
- [ ] **Memo action UX** — Ack Done, Blocked, Question, Defer, Archive, Open Source Memo, Retry Delivery
- [ ] **Delivery receipts** — track pending, delivered, failed, acknowledged, and blocked per memo
- [ ] **Privacy mode** — redact paths, environment-looking strings, and known secret patterns before staged export
- [ ] **CLAUDE.md template** — Framework gap; auto-scaffold on `initTown`
- [ ] **Registry validator** — Lint `.wildwest/registry.json` for schema compliance
- [ ] **Release artifact hygiene** — move tracked historical VSIX files out of git and keep releases in GitHub Releases or CI artifacts
