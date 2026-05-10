# TODO — wildwest-vscode

> **Last updated:** 2026-05-09T23:15Z
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
- [ ] **Session attribution — git commit signal** — Add `GitCommitMatcher` step to Rebuild orchestrator: for each town scope_ref, shell `git log --after --before` on the town repo during the session window; store `commit_count` on the scope_ref. Sessions with `commit_count > 0` are primary attributions; sessions with only `signal_count > 0` are "referenced". Use this as the default filter replacing the current recorder-wwuid proxy.
- [ ] **Session attribution — UI editorial layer** — Side panel Sessions tab shows three sub-lists: **Active** (passing filter), **Excluded** (have `exclude_scope_refs` in session-map), **Candidates** (reference this town but don't pass primary filter). Each session row has **Include** / **Exclude** inline actions that write to `.wildwest/session-map.json` and trigger Rebuild. An **Overrides** view lists all current inject/exclude entries with notes and an Undo action.
- [ ] **[v4 delivery bug] County outbox/history must not log received memos** — Received memos are appearing in the sender's outbox history. County outbox/history should only contain memos sent *from* that scope, not memos received by it. Filed per ruling `20260509-2240Z` Q3. (Authorized by S(R) via CD(RSn))

## P3 — Telegraph JSON Migration (2026-05-10)

**Scope:** Transform telegraph from `.md` files to `.json` format. Staging area created at `~/wildwest/telegraph/raw/` with all 265 memos from wildwest-ai county (3 repos).

**Notation Update (v1.1):** Per CD ruling 2026-05-09T22:40Z, memo notation uses identity(dyad) separate from routing anchor. CD approved colon `:` notation, but colon is **Windows-incompatible**. Bracket notation `[anchor]` is cross-platform alternative. **Scope tier is implicit in role** (TM→town, CD→county, RA→territory); brackets contain routing destination name only:

```
from: TM(RHk)[wildwest-vscode]    ← identity(dyad)[routing-anchor-name]
to: CD[wildwest-ai]                ← scope implicit via role lookup

Filename: 20260509-2240Z-to-CD[wildwest-ai]-from-TM(RHk)[wildwest-vscode]--subject.json
```

### Phase 1: Schema & Parser

- [ ] **Update `MemoStorageService.ts`** — Change `wwuid_type: 'memo'` → `wwuid_type: 'wire'` (thematically consistent with Wild West telegraph era terminology)
- [ ] **Optional: Rename `Memo` interface** — Consider renaming to `Wire` for full thematic consistency
- [ ] **Document scope notation decision** — Flag bracket `[scope]` as Windows-safe alternative to colon for v1.1 review with S(R)
- [ ] **Create MarkdownWireParser** — Parse `.md` files from `~/wildwest/telegraph/raw/` and convert to JSON schema
  - Extract YAML frontmatter → JSON fields
  - Extract markdown body → `body` field
  - Parse filename → store as `filename` field
  - Assign `status` based on source folder: `inbox/` → `delivered`, `outbox/` → `sent`, `history/` → `archived`
  - Preserve existing `wwuid` values (no regeneration)
  - **Handle notation variants:** Support both old `Role(town)` and new `Role(dyad)[scope]` formats during v1.1 transition
- [ ] **Write parser tests** — Validate frontmatter extraction, body preservation, status assignment, edge cases (malformed YAML, missing fields, notation variants)

### Phase 2: Migration Execution

- [ ] **Create migration script** — Process all `.md` files in `~/wildwest/telegraph/raw/` and output `.json` to new location
- [ ] **Execute migration** — Run against wildwest-ai county data
- [ ] **Verify output** — Spot-check converted files; validate index generation; confirm memo counts match source
- [ ] **Archive raw copies** — Move raw `.md` files to backup location (do not delete originals)

### Phase 3: Extension Integration (future)

- [ ] **Wire `MemoStorageService` to raw location** — Update extension to read from `~/wildwest/telegraph/raw/` instead of `.wildwest/telegraph/`
- [ ] **Update existing commands** — Ensure inbox/outbox/history views still work with new JSON storage
- [ ] **Test multi-county support** — When other counties onboard, verify migration scales
