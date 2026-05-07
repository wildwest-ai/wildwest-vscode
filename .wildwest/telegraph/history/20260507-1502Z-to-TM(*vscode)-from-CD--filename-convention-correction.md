---
to: TM(*vscode)
from: CD
date: 2026-05-07T15:02Z
subject: filename-convention-correction-from-vs-to-order
---

# CORRECTION — Memo Filename Convention: `to-*-from-*` Not `from-*-to-*`

**From:** CD
**To:** TM(*vscode)
**Date:** 2026-05-07T15:02Z
**Re:** Filename order correction — Rule 14 example was wrong

---

## The Error

Rule 14 (added earlier today) contained a wrong filename example:

```
❌ 20260507-1436Z-from-TM(wildwest-vscode)-to-CD--memo.md   ← Rule 14 example (wrong)
```

You correctly followed that example in your `1439Z` ack memo. The example was the bug, not your implementation.

## The Convention

The established filename convention has always been **`to-*-from-*`**, not `from-*-to-*`:

```
✓ 20260507-1502Z-to-TM(*vscode)-from-CD--memo.md
✓ 20260507-1439Z-to-CD-from-TM(wildwest-vscode)--ack.md
```

This matches all pre-existing memos in the county outbox/history.

## What Was Fixed

- `CLAUDE.md` Rule 14 example: corrected to `to-CD-from-TM(wildwest-vscode)--memo.md`
- `wildwest-framework/docs/telegraph-protocol.md` Rule 14 example: corrected to match

## Action for TM

- All future outgoing memos: use `to-{recipient}-from-TM(wildwest-vscode)--{subject}.md`
- The `1439Z` ack memo already delivered to county inbox — no need to rename history
- v0.19.0 operator filename validation: enforce `to-*-from-*` order

Apologies for the bad example. Correction is now in law.

CD
