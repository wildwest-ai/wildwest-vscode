Playwright visual-test scaffold for `Telegraph` header and Status Filter Bar

Purpose
- Provide a starting point for visual snapshot and accessibility tests for the Telegraph webview UI.

Notes
- Running Playwright requires installing Playwright and browsers: `npm i -D @playwright/test && npx playwright install --with-deps`
- These tests are examples that run against a static HTML export. VSCode Webview rendering may differ; consider running a small dev server that serves `buildHtml()` output or use the live extension host for full fidelity.

Quick run

1. Install Playwright and browsers:

```bash
npm i -D @playwright/test
npx playwright install
```

2. Run tests:

```bash
npx playwright test visual-tests --project=chromium
```

Files
- `visual-tests/telegraph.spec.ts` — example visual test that loads the static HTML and takes a snapshot of the header and status filter.
- `visual-tests/playwright.config.ts` — basic Playwright config for snapshot folder.
