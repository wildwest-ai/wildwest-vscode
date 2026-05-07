# TODO — wildwest-vscode

> **Last updated:** 2026-05-07T16:31Z

---

## P1 — Blocking (next release)

- [ ] **TelegraphInbox format** — `TelegraphInbox` doesn't recognize `YYYYMMDD-HHMMZ-to-...` delivered filenames; needs scan of `.wildwest/telegraph/inbox/`
- [ ] **Custom export path** — `PipelineAdapter` hard-codes `~/wildwest/sessions/{gitUsername}`; wire to `wildwest.exportPath` config setting
- [ ] **Identity block shape decision** — S(R) call needed (affects registry schema)
- [ ] **`scope: "town"` field** — Add to `.wildwest/registry.json` for all scopes
- [ ] **TownInit.ts fix** — Write `scope` field on registry creation
- [ ] **SoloModeController.hasBranchDoc()** — Check correct path (stale reference)

## P2 — Nice-to-Have

- [ ] **CLAUDE.md template** — Framework gap; auto-scaffold on `initTown`
- [ ] **Registry validator** — Lint `.wildwest/registry.json` for schema compliance

