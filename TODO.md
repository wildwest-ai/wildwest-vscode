# TODO — wildwest-vscode

> **Last updated:** 2026-04-28 15:29 UTC (11:29 EDT)

---

## ChatExport artifact cleanup

Remaining `ChatExport` / `chatExport` references to review and rename. Deferred — these are internal refactors with no runtime impact.

### Internal code identifiers

These are class and file names. Renaming requires updating all import sites.

| File | Line | Current | Candidate |
|---|---|---|---|
| `src/chatExporter.ts` | 17 | `export class ChatExporter` | `WildWestExporter` or `SessionExporter` |
| `src/chatExporter.ts` | 43 | log: `"ChatExporter constructor called"` | update with class rename |
| `src/extension.ts` | 3 | `import { ChatExporter } from './chatExporter'` | update with class rename |
| `src/extension.ts` | 9 | `let exporter: ChatExporter` | update with class rename |
| `src/extension.ts` | 22 | `new ChatExporter(...)` | update with class rename |

Consider: rename file `chatExporter.ts` → `sessionExporter.ts` (or similar) as part of the same pass.

### Hidden state file on disk

The state file written to the user's export directory. Renaming would break existing installs — a migration shim would be needed.

| File | Lines | Current filename |
|---|---|---|
| `src/chatExporter.ts` | 747, 766, 888 | `.chatexport-state.json` |

### User-visible strings

Shown in generated output files (Markdown transcripts and INDEX.md).

| File | Line | Current | Candidate |
|---|---|---|---|
| `src/jsonToMarkdown.ts` | 109 | fallback title `'Chat Export'` | `'Wild West Session'` |
| `src/generateIndex.ts` | 120 | `'# Copilot Chat Exports Index'` | `'# Wild West Session Index'` |
| `__tests__/jsonToMarkdown.test.ts` | 53 | assertion `'# Chat Export'` | update with string change |
