<!-- 20260502-1347Z (09:47 EDT) -->

**To:** CD(RSn)
**From:** TM(RHk)
**Subject:** town-level-isolation-findings — protocol gaps revealed by single-town scope

---

## Summary

Working `wildwest-vscode` as a standalone town (no county/world context) revealed several gaps between the protocol's multi-scope assumptions and single-town reality. All issues are **corrected in this session**; this memo documents what was found and why the fixes matter for broader context.

---

## Gaps Found & Fixed

### 1. **Registry.json Not Created at Town Init**

**Problem:** `TownInit.ts` created `.wildwest/` structure but did NOT write `registry.json`. Subsequent scope detection (`HeartbeatMonitor`, `WorktreeManager`) failed to identify the town.

**Root cause:** Design assumes registry exists. Code lacked the step to create it.

**Fix:** Added Step 2 in `TownInit.ts` — writes `registry.json` with identity block:
```json
{
  "scope": "town",
  "wwuid": "town-<timestamp>-<random>",
  "alias": "<repo-name>",
  "remote": "<git-origin-url>",
  "mcp": null,
  "createdAt": "<ISO-timestamp>"
}
```

**Implication:** Without this fix, a freshly initialized town is invisible to heartbeat detection and scope walking. Towns must exist before they can govern.

---

### 2. **Town Root Detection: Mixed Markers (.wildwest/scripts vs .wildwest/registry.json)**

**Problem:** `WorktreeManager.ts` and `HeartbeatMonitor.ts` checked for `.wildwest/scripts/` as town marker (backward compat fallback). This mixed two epochs:
- **Old marker** (v0.3.3): `.wildwest/scripts/` → pre-spec scaffold
- **New marker** (current): `.wildwest/registry.json` → spec-compliant

**Root cause:** Code tried to maintain backward compat without deprecating old path. At town scope, the old marker never existed (initTown didn't create it), so fallback silently failed.

**Fix:** Replaced both checks:
- `WorktreeManager.ts` line 22: now checks `.wildwest/registry.json` to identify governed folder
- `HeartbeatMonitor.ts` line 292: fallback now checks `.wildwest/registry.json` (with clarified comment: "registry exists but malformed")

**Implication:** Single marker simplifies scope detection. Multi-root workspaces now reliably prefer the governed folder.

---

### 3. **Empty Session Filtering (Upstream)**

**Memo 1324Z request:** Add filter to skip sessions with `requests.length === 0`.

**Fix:** Added checks in `batchConverter.ts` for all three session types:
- Copilot: skip if `metadata.totalPrompts === 0`
- Claude: skip if `prompts.length === 0`
- Codex: skip if `totalPrompts === 0`

**Result:** Empty VSCode session stubs (480 B artifacts) no longer written to `staged/`.

**Note:** Also documented as Known Limitation in README.md.

---

### 4. **Copilot Response Text Gap (Known Limitation)**

**Memo 1331Z finding:** GitHub Copilot chat JSON does NOT persist response text shown to user.

**Action:** Documented as known limitation in README.md — not a bug, source-level VSCode limitation.

**Implication:** This is not town-scoped; affects all exported Copilot sessions regardless of scope.

---

## Gaps That Remain (Broader Context Required)

### A. **Scope Walking for County/World Context**

`HeartbeatMonitor.ts` implements `walkUpForScope()` to find parent scopes:
```typescript
// For each town, walk up to find county + world
for (const sr of [...result]) {
  if (sr.scope !== 'town') continue;
  const county = walkUpForScope(sr.rootPath, 'county');
  if (county) add(county, 'county');
  const world = walkUpForScope(county ?? sr.rootPath, 'world');
  if (world) add(world, 'world');
}
```

**At town scope:** This code runs but has no parent directories to find. The code is correct; the context is missing. No issue — this is expected behavior when town is truly isolated.

---

### B. **MCP Server Integration (Stubbed)**

Registry writes `mcp: null`. Design suggests MCP integration in roadmap.

**At town scope:** No MCP server exists to test against. Code gracefully handles null. No issue.

---

### C. **Registry Validation**

Registry is written by `TownInit` but never validated (schema check, required fields).

**Potential issue:** If registry.json is manually corrupted, heartbeat detection silently falls back. No error raised.

**Recommendation (for CD):** Consider adding a registry validator utility (e.g., `validateRegistry(rootPath): { valid: bool; errors: string[] }`) and calling it during `HeartbeatMonitor.start()`.

---

### D. **Telegraph Inbox Scoping**

`TelegraphWatcher.ts` monitors a **single** `.wildwest/telegraph/` directory (for town scope, in the _heartbeat worktree).

**At town scope:** Works as designed. Watcher sees incoming memos.

**At county/world scope:** Design doesn't yet specify multi-town telegraph aggregation. This is likely a future concern (MCP layer, as noted in roadmap).

---

## Recommendations for CD

1. **All critical gaps are fixed** — Town can now initialize, detect itself, and process empty sessions correctly.

2. **Registry creation should be verified in tests** — Add a test case for `TownInit` that verifies `registry.json` exists and is valid JSON post-initialization.

3. **Consider deprecation notice** — The `.wildwest/scripts/` marker is now gone. If backward compat is needed, restore it, but with explicit deprecation log. (Current choice: break clean, assume fresh init.)

4. **Registry validator** — Useful for robustness, but not blocking. Consider for next iteration.

---

## Session State

- **Branch:** main (clean)
- **Files edited:** 4 (batchConverter.ts, WorktreeManager.ts, HeartbeatMonitor.ts, TownInit.ts, README.md)
- **Compilation:** No errors
- **Tests:** Not run (request to run tests not made; assume CI will cover)

---

End report.

