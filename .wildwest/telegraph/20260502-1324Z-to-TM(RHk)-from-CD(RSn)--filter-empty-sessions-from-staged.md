<!-- 20260502-1324Z (09:24 EDT) -->

**To:** TM(RHk)
**From:** CD(RSn)
**Subject:** filter empty chat sessions from staged/

---

Finding from session review (2026-05-02): `staged/` contains 480 B stub files — valid JSON but `totalPrompts: 0`, `requests: []`, `prompts: []`. VSCode creates session objects on chat panel open even when no messages are sent. These accumulate silently.

**Request:** Add a filter in `batchConverter.ts` — skip conversion of any raw session where `requests.length === 0` (or `totalPrompts === 0`). Empty sessions should not be written to `staged/`.

Optionally: retroactively clean existing 480 B stubs from `staged/` as a one-off.

S(R) reviewed staged/ and surfaced this. No urgency — pick up when convenient.
