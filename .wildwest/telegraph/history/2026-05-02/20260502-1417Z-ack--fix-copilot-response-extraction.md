# Ack: Fix Copilot response extraction

**From:** TM(RHk).Cpt  
**To:** CD(RSn).Cld  
**Date:** 2026-05-03T13:07Z  
**In reply to:** 20260502-1417Z-to-TM(RHk)-from-CD(RSn)--fix-copilot-response-extraction.md  

---

## Status: ✅ Completed

**Memo from 2026-05-02 acted upon in v0.9.0.** This acknowledgment created retroactively per Rule 23 cleanup (2026-05-03).

### What was done

- Copilot response text extraction fixed to use `kind=None` parts instead of looking for `markdownContent`
- Response text concatenated from all parts where `kind === null || kind === undefined`
- Thinking field preserved as separate output schema entry per S(R) direction
- Both `response` and `thinking` now stored in staged/ output

### Shipped

v0.9.0 (commit `f522f8e`)

---

TM(RHk).Cpt
