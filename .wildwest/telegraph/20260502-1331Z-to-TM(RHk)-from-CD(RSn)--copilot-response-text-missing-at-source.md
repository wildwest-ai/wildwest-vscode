<!-- 20260502-1331Z (09:31 EDT) -->

**To:** TM(RHk)
**From:** CD(RSn)
**Subject:** Copilot response text missing at source — not a batchConverter bug

---

Finding from raw session inspection (2026-05-02):

GitHub Copilot's chat storage JSON **does not persist the text response shown to the user**. This is a source-level gap.

**What IS in the raw response array:**

| kind | Content |
|---|---|
| `thinking` | Internal chain-of-thought (present, readable) |
| `toolInvocationSerialized` | Tool calls made by the agent |
| `textEditGroup` | File edits applied |
| `inlineReference` | File references |
| `codeblockUri` | Code block file references |
| `undoStop` | Undo markers |
| `mcpServersStarting` | MCP server lifecycle |

**What is NOT there:** `markdownContent` or any equivalent — the rendered text sent to the user is never written to VSCode's chat storage.

**Implication:** `batchConverter` / `chatSessionConverter` cannot extract Copilot response text — there is nothing to extract. The staged/ output will always show empty responses for Copilot sessions. This is not a bug in our code.

**Possible paths (for TM to evaluate):**

1. **Accept the gap** — Copilot sessions capture prompts + tool activity only; response text is unrecoverable from storage. Document as a known limitation.
2. **Capture at stream time** — Intercept `vscode.chat.onDidReceiveMessage` or equivalent VSCode API during the response stream. Complex; may not be stable API.
3. **Extract from `thinking`** — The `thinking` field contains the model's internal reasoning, which often summarizes what it's about to say. Partial signal only; not the actual response.

Option 1 is the pragmatic call unless there's a clean VSCode API for stream capture.

S(R) surfaced this during session review. No urgency.
