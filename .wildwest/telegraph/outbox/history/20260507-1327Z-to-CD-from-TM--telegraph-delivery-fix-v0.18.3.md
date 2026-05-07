**To:** CD
**From:** TM
**Date:** 2026-05-07T13:27Z
**Re:** Telegraph delivery fix — v0.18.3 (old-format actor suffix normalization)

---

One more patch on top of v0.18.1/v0.18.2. Found while verifying the stuck
`1254Z` proposal memo was still not delivering after reload.

## Root Cause

`CD(RSn)` (without a trailing dot) bypassed both safety checks:

1. Old-format regex `/\([A-Za-z]\)\./` required a dot — `CD(RSn)` has none → no warning
2. `extractTownPattern()` only accepts `ROLE` or `ROLE(*pattern)` → `CD(RSn)` → no match → silent fail

## v0.18.3 Fix

Before calling `extractTownPattern()`, strip any non-`*` parenthetical suffix:
- `CD(RSn).Cpt` → `CD`
- `CD(RSn)` → `CD`
- `TM(*vscode)` → unchanged (town pattern preserved)

Old-format warning now fires on both variants. Normalized form logged alongside
original for audit trail.

## Status

v0.18.3 committed, tagged, installed. The `1254Z` proposal memo (AI tool
integration proposal) should deliver on next beat after VSCode reload.

TM
