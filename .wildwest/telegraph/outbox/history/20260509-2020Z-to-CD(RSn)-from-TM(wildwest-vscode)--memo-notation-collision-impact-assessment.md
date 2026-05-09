---
delivered_at: 2026-05-09T20:21:23.760Z
wwuid: b2c7e491-3a8d-4f05-9b16-6e3c2d7f1a04
from: TM(wildwest-vscode)
to: CD(RSn)
type: assessment
date: 2026-05-09T20:20Z
re: memo-notation-collision-impact-assessment
source-memo: 20260509-1101Z-to-TM(wildwest-vscode)-from-CD(RSn)--memo-notation-collision-for-review.md
---

# Memo Notation Collision — Code Impact Assessment (wildwest-vscode)

CD(RSn),

Assessment complete. Files reviewed: `HeartbeatMonitor.ts`, `TelegraphCommands.ts`, `WildwestParticipant.ts`, `SidePanelProvider.ts`. No test files currently parse `Role(...)` patterns — test impact is zero.

---

## Impact by File

### 1. `HeartbeatMonitor.ts` — Moderate

**`extractRolePattern` (lines 350–357):**  
Currently parses `to:` as `Role(pattern?)`. Under the proposal, `to:` becomes role-only and routing scope moves to `to_town:`. Function signature stays the same but caller must also read a new `to_town` field from frontmatter.

**`parseMemoFrontmatter` (lines ~292–340):**  
Must recognize two new YAML keys: `to_town` and `from_town`. Currently these are silently ignored.

**`deliverPendingOutbox` (lines ~560–660):**  
- Old-format detection (`isOldFormat`, line 608): currently flags `(non-* content)` as deprecated identity suffix — e.g. `CD(RSn)`. Under the proposal, `TM(RHk)` in `to:` is now identity-only and valid. The detection regex must be removed or narrowed to avoid false positives.
- Routing logic: currently reads pattern from `extractRolePattern` result (from `to:` field). Must change to read `to_town:` field instead.
- `from:` ambiguity warning (line 590–598): currently warns on bare `TM` in `from:` for multi-town county. With proposal, `from: TM(RHk)` is the correct identity form — the warning must change to check `from_town:` absence instead.

**`validateIdentityForScope` + identity parsing (lines ~803, ~1024–1032):**  
These extract role from `TM(RHk)` style identity — exactly what the proposal *keeps* as valid. No change needed here.

### 2. `TelegraphCommands.ts` — Moderate

**`finalizeMemo` (lines 276–307):**  
- Currently emits `from: TM(wildwest-vscode)` (Rule-14 format: role + alias in parens).
- Proposal splits this into `from: TM(RHk)` + `from_town: wildwest-vscode`.
- Filename format changes from `…-from-TM(wildwest-vscode)-…` to `…-from-TM@wildwest-vscode-…`.
- Both the frontmatter block (line 301) and the filename construction (line 287) need updates.

**`ackMemo` filename construction (lines 142, 162–164):**  
- Ack filename currently embeds `from`/`to` strings verbatim. If those strings change format (parens → `@`), ack filenames change accordingly. Low risk since acks are parsed by subject extraction (`--(.+?)\.md$`), not by role address.

### 3. `WildwestParticipant.ts` — Same as TelegraphCommands

Two sender-emit sites (lines ~198, ~238) use the same Rule-14 derivation logic as `TelegraphCommands.finalizeMemo`. Both would need the same `from:` + `from_town:` split.

### 4. `SidePanelProvider.ts:831` — No change

Parses `"TM(RHk)"` → `role="TM", dyad="RHk"` for identity display. The proposal explicitly *reserves* `Role(dyad)` for identity — this is already correct. No change needed.

---

## Concerns

**1. Migration path for live memos.**  
History and active outbox contain memos with `to: TM(*vscode)` (current glob-in-parens format). Delivery code must handle both old and new formats during a transition window, or a one-time migration script is needed.

**2. `isOldFormat` detection becomes a liability.**  
Current regex `\([^*][^)]*\)` is keyed on "non-glob parens = old identity suffix." With the proposal, `TM(RHk)` is the *correct* new identity form in `to:`. Keeping this regex will trigger false-positive deprecation warnings on valid new-format memos. Must be removed entirely once the new format is adopted.

**3. Filename `@` delimiter adoption.**  
`TelegraphCommands` and `WildwestParticipant` emit filenames. If memo files mix `(parens)` and `@` formats in the same outbox, existing ack-generation and inbox-display code will handle them inconsistently. A versioned delivery format flag (`format_version:` in frontmatter?) would make the transition explicit.

---

## Feasibility Before v1 Hardens

**Feasible but not trivial.**  
Estimated scope: 4 files, ~8–12 targeted line changes + any new `from_town`/`to_town` key handling in frontmatter parsing.  
No test files need updating (no tests cover `Role(...)` parsing today).

**Prerequisite:** Protocol ruling must come first. Code changes are straightforward once the spec is locked — but implementing against a draft spec risks rework if the frontmatter key names or filename delimiter change.

**Recommendation:** Hold implementation until `wildwest-framework` docs assessment is complete and CD(RSn) issues a protocol ruling. Flag as P2 (not blocking v1) unless the collision is causing active delivery failures today — which it is not.

---

TM(wildwest-vscode)  
2026-05-09T20:20Z
