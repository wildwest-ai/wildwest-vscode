# feat/context-sensitive-prompts — Branch Doc

> **Last updated:** 2026-05-10 12:32 UTC
> **Status:** Merged
> **Created:** 2026-05-10 — RCx
> **Type:** feature / governance UX
> **Owner:** RCx
> **Base branch:** main

---

## Purpose

Improve generated prompt suggestions so session-derived prompts are context sensitive by scope and aligned with the Wild West framework.

## Scope

### In Scope

- Prompt index filtering for terminal output, continuation prompts, and authorization snippets
- Context-aware prompt scoring based on reusable intent and framework compliance
- Scope-aware search behavior that prefers exact scope and inherited governance context
- User-facing prompt search details that expose prompt kind and compliance state
- Tests for prompt classification, scoring, and scoped search

### Out of Scope

- Raw session export format changes unrelated to prompt indexing
- Large framework registry refactors
- Telegraph delivery protocol changes

## Done Criteria

- [x] Branch doc created
- [x] Prompt index distinguishes reusable prompts from operational/session noise
- [x] Search can include scope lineage without falling back blindly to global prompts
- [x] Framework-stale terminology/addressing is penalized or flagged
- [x] Tests pass
- [x] PR opened
- [x] Release built and installed after merge

## Notes

- PR #10 merged into `main` on 2026-05-10.
- This branch intentionally started from local `main` because the prompt-index implementation existed in that line.
- Validation: `npm test -- --runInBand` passed on 2026-05-10 (18 suites / 247 tests). Lint reports three existing warnings in unrelated files.
