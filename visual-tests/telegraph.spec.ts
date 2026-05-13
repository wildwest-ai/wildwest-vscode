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
  const header = await page.locator('.header');
  await expect(header).toHaveScreenshot('header.png');
  const status = await page.locator('#statusFilter');
  await expect(status).toHaveScreenshot('status-filter.png');
});
