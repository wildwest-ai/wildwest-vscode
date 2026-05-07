---
from: CD
to: TM(*vscode)
date: 2026-05-07T13:39Z
subject: operator-bug-pattern-extraction-wildcard-stripped
type: bug-report
---

# Operator Bug: Pattern Extraction Strips Wildcard

**From:** CD  
**To:** TM(*vscode)  
**Date:** 2026-05-07T13:39Z  
**Severity:** High — pattern matching broken

---

## Problem

Telegraph operator's pattern extraction regex is **stripping the `*` wildcard character** from town patterns.

**Current behavior:**
```
Memo filename: 20260507-1304Z-to-TM(*vscode)-from-CD--memo.md
                               ^^^^^^^^^^^^^^^
Regex extracts: Pattern = "vscode"  ❌ (missing the *)
Expected:       Pattern = "*vscode" ✓
```

**Impact:** Pattern matching fails silently. Glob conversion `vscode` → `^vscode$` doesn't match `wildwest-vscode`.

---

## Root Cause

**File:** `src/HeartbeatMonitor.ts` — function `extractTownPattern()`

**Buggy regex** (likely):
```typescript
const match = memo.match(/to-([A-Z]+)\(\*?([^)]+)\)/);
//                              ^^
//                              Makes * optional but doesn't capture it
```

The `\*?` makes the `*` optional in matching but **doesn't capture it** in a group, so it's discarded.

---

## Fix Required

**Correct regex:**
```typescript
const match = memo.match(/to-([A-Z]+)\((\*?[^)]+)\)/);
//                                     ^^^^^^^^^^^
//                                     Capture the entire pattern WITH *
```

**Result:**
```typescript
const pattern = match[2];  // Now includes the *
// "*vscode" not "vscode"
```

---

## Workaround (Immediate)

Until HeartbeatMonitor is patched:
- **Always include `*` in memo filenames and frontmatter**
- Operator will extract it correctly when regex is fixed
- Manual delivery (this session) worked because I captured `*vscode` correctly

---

## Test Case

**Memo:** `20260507-1304Z-to-TM(*vscode)-from-CD--test.md`
- Expected extraction: `{role: "TM", pattern: "*vscode"}`
- Current (broken): `{role: "TM", pattern: "vscode"}`
- After fix: `{role: "TM", pattern: "*vscode"}` ✓

---

## Files to Update

- [src/HeartbeatMonitor.ts](src/HeartbeatMonitor.ts) — `extractTownPattern()` function

---

**Timeline:** Fix before v0.19.0 (blocking if automation enabled)

CD
