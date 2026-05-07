# Comprehensive Repository Review - 2026-05-07 11:45Z

Scope: entire repository, excluding `.wildwest/` per review request.

## Summary

This review found several release-blocking issues in startup behavior, telegraph delivery, and verification. The most important risk is that the extension can call `process.exit(1)` during normal startup when no raw sessions exist. Telegraph v2 is also not internally consistent yet: send, delivery, watch, and inbox processing do not agree on address format, role routing, or inbox location.

No code changes were made as part of this review.

## Findings

### High - Startup can terminate the extension host

`SessionExporter.start()` auto-runs `batchConvertSessions(true)` on activation. `BatchChatConverter.run()` calls `process.exit(1)` when no raw session files are found. In a normal new install or clean export directory, this can terminate the VS Code extension host instead of treating "no sessions yet" as a no-op.

References:

- `src/sessionExporter.ts:820`
- `src/batchConverter.ts:581`

Recommended fix: make `BatchChatConverter` library-safe. It should throw or return a result in CLI/library mode, and only the CLI `main()` should call `process.exit(...)`.

### High - Delivered telegraph memos are not processable

Delivery writes remote memos to `.wildwest/telegraph/inbox/`, but `TelegraphInbox.getPendingMemos()` scans the telegraph root and filters for filenames starting with `to-`. Generated and delivered memo filenames use the `YYYYMMDD-HHMMZ-to-...` shape, so `wildwest.processInbox` can report an empty inbox even after delivery succeeds.

References:

- `src/HeartbeatMonitor.ts:518`
- `src/TelegraphInbox.ts:17`
- `src/TelegraphInbox.ts:60`

Recommended fix: have `TelegraphInbox` scan each `telegraph/inbox/` directory and accept the same filename/frontmatter shape produced by delivery.

### High - Telegraph send and delivery disagree on address format

`telegraphSend` prompts for the old `Role(Actor).Channel` format and hard-codes `from: TM(RHk).Cpt`. Delivery now parses only role-only or role-with-pattern format, so memos created by the command can fail delivery. The deprecated-format detector also misses realistic old values such as `CD(RSn).Cpt`.

References:

- `src/TelegraphCommands.ts:231`
- `src/TelegraphCommands.ts:289`
- `src/HeartbeatMonitor.ts:480`

Recommended fix: update `telegraphSend` to use `wildwest.actor` and v2 role/pattern prompts, and either fully support old-format parsing during the transition or reject it with a clear message.

### High - Role routing is ambiguous for `TM`

`TM` appears in both county and town roles. `resolveRoleToScope()` returns the first matching scope, so production routing resolves `TM` to county before it can route to a town. This conflicts with the documented `TM(*vscode)` town-to-town routing.

References:

- `src/HeartbeatMonitor.ts:17`
- `src/HeartbeatMonitor.ts:288`

Recommended fix: remove overlapping role ambiguity or make the resolver context-aware. Patterned town addresses should resolve to town before county fallback.

### Medium - Custom `wildwest.exportPath` is ignored by the session pipeline

Raw exports honor `wildwest.exportPath`, but the new `PipelineAdapter` is initialized with `~/wildwest/sessions/{gitUsername}` regardless of configuration. Users with a custom export path will get raw exports in one place and packet/storage output in another.

References:

- `src/sessionExporter.ts:50`
- `src/sessionExporter.ts:66`

Recommended fix: initialize `PipelineAdapter` with `this.exportPath` or a documented child of it.

### Medium - Shell injection risk in git username setup

The Git username entered through `showInputBox()` is interpolated into `execSync(...)`. Quotes or shell metacharacters in the input can execute commands.

References:

- `src/sessionExporter.ts:692`
- `src/sessionExporter.ts:707`

Recommended fix: use `execFileSync` or `spawn` with argument arrays, and validate the username more strictly.

### Medium - VSIX packages internal and non-runtime files

`.vscodeignore` excludes `.wildwest/worktrees/**` but not the rest of `.wildwest/**`, `src/**`, or `__tests__/**`. Inspecting `build/wildwest-vscode-0.17.0.vsix` showed internal governance data, source files, and tests inside the package.

References:

- `.vscodeignore:1`
- `build/wildwest-vscode-0.17.0.vsix`

Recommended fix: exclude `.wildwest/**`, `src/**`, `__tests__/**`, local docs that are not needed at runtime, and historical build artifacts from package contents.

### Low - Status bar listeners and interval are not disposed

`StatusBarManager.startListening()` registers configuration/workspace listeners and starts a periodic interval, but `dispose()` only disposes the status bar item. This can leave callbacks behind across extension lifecycle events.

References:

- `src/StatusBarManager.ts:50`
- `src/StatusBarManager.ts:62`
- `src/StatusBarManager.ts:70`

Recommended fix: store disposables and the interval handle, then clean them up in `dispose()`.

## Verification

`npm test` is red:

- `npm run compile` passes.
- `npm run lint` fails with 21 `@typescript-eslint/no-explicit-any` errors and 7 warnings in `src/sessionPipeline/*`.
- Jest does not run through `npm test` because `pretest` fails first.

Direct Jest run is also red:

- Command: `npx jest --runInBand`
- Result: 2 failed suites, 4 failed tests, 5 passed suites.
- Failing areas:
  - `__tests__/chatSessionConverter.test.ts`: expected `kind: "text"` response extraction, but current converter returns an empty response for that fixture.
  - `__tests__/telegraphDeliveryV2.test.ts`: deprecated old-format regex does not detect `CD(RSn).Cpt`, so old-format transition tests fail.

## Test Coverage Gaps

- Telegraph delivery tests duplicate simplified helper implementations inside test files instead of exercising production `HeartbeatMonitor` delivery logic.
- Telegraph inbox processing is not covered end-to-end with a delivered memo in `inbox/`.
- Session pipeline startup integration is not covered for the empty raw directory case.
- VSIX packaging contents are not checked in CI.

## Recommended Fix Order

1. Remove `process.exit(...)` from library code and make empty raw directories a startup no-op.
2. Align telegraph v2 send, delivery, watch, and inbox processing around one address and filename contract.
3. Resolve `TM` role ambiguity and add production-backed delivery tests.
4. Fix custom export path handling in `PipelineAdapter`.
5. Replace shell-interpolated `git config user.name` with argument-safe execution.
6. Clean `.vscodeignore` and add a package-content check.
7. Dispose status bar listeners and intervals.
8. Fix lint and Jest failures, then make `npm test` the release gate.
