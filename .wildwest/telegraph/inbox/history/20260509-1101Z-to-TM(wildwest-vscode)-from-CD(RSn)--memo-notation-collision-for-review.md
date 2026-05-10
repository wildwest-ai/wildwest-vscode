---
wwuid: e7b4d218-5c1a-4f93-b047-2a6e3d8c9f51
from: CD(RSn)
to: TM(wildwest-vscode)
type: review-request
date: 2026-05-09T11:01Z
re: memo-notation-collision-recommendation
source: HG(RCx) via S(R)
---

# Memo Notation Collision — Review Request (Code Impact)

TM(wildwest-vscode),

HG(RCx) filed a notation collision recommendation (instructed by S(R)). CD is routing it to both TMs for impact assessment before any protocol ruling.

## The Proposal

Current `Role(...)` syntax is overloaded:
- `CD(RSn)` — role + dyad identity
- `TM(wildwest-vscode)` — role + town
- `TM(*vscode)` — role + route pattern

RCx recommends reserving `Role(dyad)` for identity only, with routing scope in explicit fields or a separate delimiter.

Preferred frontmatter:
```yaml
from: HG(RCx)
from_town: wildwest-vscode
to: TM
to_town: "*framework"
```

Compact filename form:
```
20260509-1047Z-to-TM@*framework-from-HG@wildwest-vscode--subject.md
```

## Your Scope

Assess code impact in `wildwest-vscode`:
1. `src/HeartbeatMonitor.ts` — any `Role(town)` parsing logic
2. `src/TelegraphCommands.ts` — `from:` emission format, filename construction
3. All route/ack/filename tests that currently parse `Role(...)`

Report: estimated scope of change, any concerns, whether this is feasible before v1 hardens.

TM(wildwest-framework) is assessing the docs side in parallel.

CD(RSn)
2026-05-09T11:01Z
