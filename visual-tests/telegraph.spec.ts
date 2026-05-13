import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

// This test loads the static HTML template produced by `TelegraphPanel.buildHtml()`
// (extracted from source) and snapshots header + status-filter. For full fidelity
// run using the extension host or render the webview HTML inside a small static
// server that mirrors webview CSS variables.

function extractHtmlFromSource(): string {
  const src = path.resolve(__dirname, '..', 'src', 'TelegraphPanel.ts');
  const content = fs.readFileSync(src, 'utf8');
  const marker = 'private buildHtml(): string {';
  const idx = content.indexOf(marker);
  if (idx === -1) throw new Error('buildHtml marker not found');
  const start = content.indexOf('return `', idx);
  const end = content.lastIndexOf('`;', content.indexOf('dispose(): void'));
  if (start === -1 || end === -1) throw new Error('Could not extract HTML template');
  const raw = content.slice(start + 8, end);
  return raw;
}

test('header and status filter visual snapshot', async ({ page }) => {
  const html = extractHtmlFromSource();
  await page.setContent(html, { waitUntil: 'networkidle' });
  // Ensure the status filter has visible sample chips for snapshotting
  await page.evaluate(() => {
    const status = document.getElementById('statusFilter');
    if (!status) return;
    status.classList.add('visible');
    status.innerHTML = '' +
      '<button class="sf-btn active" data-status="sent" aria-pressed="true">New <span class="chip-count">3</span></button>' +
      '<button class="sf-btn" data-status="read" aria-pressed="false">Read <span class="chip-count">12</span></button>' +
      '<button class="sf-btn" data-status="archived" aria-pressed="false">Archived <span class="chip-count">4</span></button>' +
      '<button class="sf-btn" data-status="all" aria-pressed="false">All <span class="chip-count">19</span></button>';
  });

  const header = await page.locator('.header');
  await expect(header).toHaveScreenshot('header.png');
  const status = await page.locator('#statusFilter');
  await expect(status).toHaveScreenshot('status-filter.png');

  // Accessibility: inject axe-core and run checks
  const axePath = path.join(__dirname, '..', 'node_modules', 'axe-core', 'axe.min.js');
  if (fs.existsSync(axePath)) {
    await page.addScriptTag({ path: axePath });
    const results = await page.evaluate(async () => {
      // @ts-ignore
      return await (window as any).axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] } });
    });
    const violations = results.violations || [];
    if (violations.length > 0) {
      const out = path.join(__dirname, 'axe-violations.json');
      fs.writeFileSync(out, JSON.stringify(violations, null, 2));
      throw new Error('Accessibility violations found; details written to ' + out);
    }
  }
});
