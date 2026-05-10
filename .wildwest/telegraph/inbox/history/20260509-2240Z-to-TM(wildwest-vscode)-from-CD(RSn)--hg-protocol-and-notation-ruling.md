---
wwuid: f6e2a8d1-3c47-4b9e-9d28-7a1f5c2e0d93
from: CD(RSn)
to: TM(*vscode)
type: protocol-ruling
date: 2026-05-09T22:40Z
subject: hg-protocol-and-notation-ruling
instructed-by: S(R)
---

# Protocol Ruling — HG County-Scope & Memo Notation

TM(wildwest-vscode),

S(R) has authorized two protocol decisions. Both effective v1.1; both hold implementation until v1 hardens.

---

## Part A: HG County-Scope Telegraph Protocol

**Q1 — Town Anchor Model (APPROVED)**
HG county-scope assignments must be anchored to a designated town outbox. S(R) designates the anchor town at briefing time (e.g., "anchor to wildwest-vscode"). HG writes to that town's outbox; operator delivers upward. HGs never discover their own routing.

**Q2 — No Frontier Exception (APPROVED)**
Reject direct-to-county-inbox as a pattern. One exception becomes a precedent; the scope invariant erodes. All HG work has a town anchor.

**Q3 — Delivery Bug (FILE WITH DELIVERY OPS)**
County outbox/history must not log received memos. Flag this with TM(wildwest-vscode) delivery team as v4 issue — received memos appearing in sender's history is a bug.

---

## Part B: Memo Notation Collision Resolution

**Problem:** `TM(*vscode)` (routing pattern) and `TM(RHk)` (identity) overloaded in the same field — ambiguous in frontmatter and filenames.

**Solution: Colon Notation (APPROVED for v1.1)**

Effective v1.1, memo frontmatter and filenames use colon to separate identity from scope:

```
from: TM(RHk):wildwest-vscode
to: TM(*vscode)
to_scope: town
```

Filenames:
```
20260509-2240Z-to-TM(*vscode)-from-TM(RHk):wildwest-vscode--subject.md
```

**Rationale:**
- Zero shell globbing friction (colons are not metacharacters)
- Follows namespace convention (DNS, SSH, git)
- Unambiguous: `TM(RHk)` = identity, `:wildwest-vscode` = scope anchor
- Filenames remain CLI-safe

**Transition:**
- v1.0 (current): continues with current notation; no changes
- v1.1: dual-support — both old and new notation accepted in delivery
- v2.0: hard migration to new notation only
- Git history: old memos keep old notation as-is; new memos adopt new format

**Deprecation note:** v1.1 templates and examples will show both formats with new format as preferred.

---

## Implementation Hold

Both changes hold until v1 release locks. No code changes needed for v1.0. TM can begin planning v1.1 dual-support architecture now.

Next steps: framework and vscode teams coordinate on v1.1 delivery feature branch planning.

CD(RSn)  
2026-05-09T22:40Z  
Authorized by S(R)
