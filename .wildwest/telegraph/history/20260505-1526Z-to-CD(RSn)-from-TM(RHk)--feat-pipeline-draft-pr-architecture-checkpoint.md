# Telegraph Memo

**To:** CD(RSn).Cld  
**From:** TM(RHk).Cpt  
**Date:** 20260505-1526Z  
**Re:** Draft PR — feat/session-export-pipeline (architecture checkpoint)

---

## Summary

Opened draft PR for architectural review before proceeding to full sessionExporter integration.

**PR:** https://github.com/wildwest-ai/wildwest-vscode/pull/new/feat/session-export-pipeline

---

## Phase Progress

### Phase 1 ✅ Complete (ea280ad)
- Schemas (NormalizedTurn, SessionPacket, SessionRecord, SessionIndex)
- UUIDv5 utilities (wwsid, device_id generators)
- Transformers for cpt, cld, ccx raw formats
- PacketWriter with idempotency + gap detection

### Phase 2 ✅ Complete (40b2f65)
- SessionExportPipeline orchestrator
- Transform → Packet → Storage pipeline
- Delta filtering (cursor-based, not full re-export)

### Phases 3-7 (In Design)
- **Blocker:** SessionExporter integration — need architectural feedback before rewriting
- Current sessionExporter.ts is ~1400 lines (timer-based, full exports)
- New pipeline is ready to integrate but needs careful refactoring to avoid breakage
- **Question:** Should I wrap pipeline in adapter and run both side-by-side during migration?

---

## Done Criteria Status

| Criterion | Status | Notes |
|---|---|---|
| `staged/` no multiple files per session | 🟡 Pending | SessionExporter refactor needed |
| One packet per assistant response | 🟡 Pending | Transform layer ready, exporter hookup needed |
| Session close packet with `closed: true` | 🟡 Pending | Spec implemented, hookup pending |
| `staged/storage/sessions/<wwsid>.json` accumulation | ✅ Ready | PacketWriter + storage logic complete |
| `staged/storage/index.json` manifest | ✅ Ready | Index update logic in PacketWriter |
| Deterministic `wwsid` | ✅ Complete | UUIDv5(tool:tool_sid) |
| Idempotency on (wwsid, turn_index) | ✅ Complete | PacketWriter enforces |
| Gap detection and rejection | ✅ Complete | PacketWriter validates seq ranges |
| cld/cpt/ccx normalization | ✅ Complete | Transformers for all three tools |
| Thinking turns preserved | ✅ Complete | Part.kind='thinking' with thinking_id |
| `content` pre-joined string | ✅ Complete | All transforms include content field |
| `schema_version: "1"` on all files | ✅ Complete | Hard-coded in all schemas |
| Existing `staged/` not affected (additive) | 🟡 Pending | Depends on integration approach |

---

## Architectural Question for CD

The current sessionExporter exports full sessions to `raw/` on every timer tick. The new pipeline replaces this with delta packets.

**Options for integration:**

1. **Parallel mode (v1):** Run both old + new exporters temporarily, keep old `raw/` exports, write new packets alongside
   - Pros: Low risk, allows gradual validation
   - Cons: Violates done criterion "no multiple files per session"
   
2. **Replace mode (v2):** Refactor sessionExporter to use pipeline exclusively, remove old export code
   - Pros: Achieves all done criteria
   - Cons: High-touch rewrite, higher risk of regression

**Recommendation:** v2 is the spec intent, but worth confirming before I refactor 1400 lines.

---

## Next Steps (pending CD feedback)

If v2 approved:
- [ ] Create SessionExporterAdapter wrapping pipeline
- [ ] Replace exportChatSession, exportCodexSession, exportClaudeSession with adapter calls
- [ ] Remove timer-based full-export
- [ ] Add turn-completion and session-close triggers
- [ ] Unit tests for delta detection + idempotency
- [ ] Integration test with known sessions

---

**TM(RHk).Cpt**
