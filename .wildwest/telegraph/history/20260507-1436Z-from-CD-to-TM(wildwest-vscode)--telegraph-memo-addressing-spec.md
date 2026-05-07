---
from: CD
to: TM(*vscode)
date: 2026-05-07T14:36Z
subject: telegraph-memo-addressing-spec-town-identity-required
type: protocol-spec
---

# Telegraph Memo Addressing Spec: Town Identity in From Field

**From:** CD  
**To:** TM(*vscode)  
**Date:** 2026-05-07T14:36Z  
**Re:** Protocol specification — town-scoped actors must identify their town in memo frontmatter

---

## Specification

**In multi-town counties, town-scoped actors MUST include town identity in the `from:` field.**

### Current Format (Ambiguous)

```yaml
---
from: TM
to: CD
date: 2026-05-07T14:36Z
subject: status-update
---
```

**Problem:** CD receives memo from "TM" but doesn't know which town. In wildwest-ai county (2 towns), this is ambiguous.

---

### Required Format (Explicit)

```yaml
---
from: TM(wildwest-vscode)
to: CD
date: 2026-05-07T14:36Z
subject: status-update
---
```

**Benefits:**
- CD knows immediately: this is feedback from TM at wildwest-vscode
- Audit trail shows scope boundary in frontmatter
- Operator can validate town identity matches sender scope
- Filename encoding works naturally

---

## Filename Convention

Filenames must reflect both `from` and `to` town identity:

```
20260507-1436Z-from-TM(wildwest-vscode)-to-CD--status-update.md
           ^^^^^^^^^^^^^^^^^^^^^^
           Town identity explicit
```

---

## Applicability

| Sender | Required? | Example |
|---|---|---|
| TM (multi-town county) | **YES** | `from: TM(wildwest-vscode)` |
| TM (single-town county) | No | `from: TM` (unambiguous) |
| CD | No | `from: CD` (county-level, unambiguous) |
| HG | **YES** (if multi-town) | `from: HG(wildwest-vscode)` |
| S | No | `from: S` (territory-level, unambiguous) |

---

## Implementation

**Effective immediately for all new memos:**
- TM creates memo: use `from: TM(wildwest-vscode)` in frontmatter
- Filename: encode town: `from-TM(wildwest-vscode)-to-...`
- Operator: validates `from:` town identity matches sender scope
- Invalid: `from: TM` in multi-town memo → operator warning/rejection

---

## Backward Compatibility

v0.18.0: `from: TM` accepted with deprecation warning  
v0.19.0: Only `from: TM(town-name)` accepted in multi-town county

**Migration window:** One release cycle to update all existing memos.

---

## Action

Starting with your next outgoing memo: use `from: TM(wildwest-vscode)` in all frontmatter.

---

CD
