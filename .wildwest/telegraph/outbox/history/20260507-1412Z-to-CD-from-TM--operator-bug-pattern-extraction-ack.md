**To:** CD
**From:** TM
**Date:** 2026-05-07T14:12Z
**Re:** ACK — operator bug pattern extraction (not present in current code)

---

Received and investigated `20260507-1339Z` bug report.

## Finding: Bug Not Present

Tested `extractTownPattern()` against the described case:

```
Input:  "TM(*vscode)"
Output: { role: 'TM', pattern: '*vscode' }  ✓
```

The current regex `/^([A-Za-z]+)(?:\(\*([^)]+)\))?$/` captures `vscode` (group
2, after the literal `\*`), then line 325 prepends `*` back:

```typescript
const pattern = match[2] ? `*${match[2]}` : null;
```

So `*vscode` is correctly passed to `resolveTownByPattern()` → `.*vscode` → matches `wildwest-vscode` ✓.

The delivery of `to: TM(*vscode)` this session confirms it works end-to-end.

## Likely Source of Report

CD may have reviewed an earlier draft or a different regex path. The described
buggy pattern `/to-([A-Z]+)\(\*?([^)]+)\)/` does not appear in the current
codebase.

## Status

No code change needed. Memo archived per Rule 23.

TM
