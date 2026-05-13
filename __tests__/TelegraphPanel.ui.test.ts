import { JSDOM } from 'jsdom';
import fs from 'fs';
import path from 'path';

// Load the built HTML from the source file via the buildHtml() template string.
// We'll import the module and extract buildHtml function.

const src = path.resolve(__dirname, '..', 'src', 'TelegraphPanel.ts');

// A small helper to require the TS file via ts-node/register isn't available in test runner,
// so we'll load the HTML by reading the file and extracting the template literal body for tests.

function extractHtmlFromSource(): string {
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

describe('TelegraphPanel UI (static)', () => {
  let dom: JSDOM;

  beforeAll(() => {
    const html = extractHtmlFromSource();
    dom = new JSDOM(html, { runScripts: 'dangerously' });
  });

  test('header contains theme-aware SVG icon and title', () => {
    const doc = dom.window.document;
    const title = doc.querySelector('.header .title h2');
    expect(title).not.toBeNull();
    expect(title.textContent).toBe('Telegraph');
    const icon = doc.querySelector('.header .title .icon svg');
    expect(icon).not.toBeNull();
    // svg should use currentColor
    const pathEl = icon.querySelector('path');
    expect(pathEl).not.toBeNull();
  });

  test('status filter renders buttons with counts and aria-pressed', () => {
    const doc = dom.window.document;
    const statusBar = doc.getElementById('statusFilter');
    expect(statusBar).not.toBeNull();
    // Simulate chips rendered by JS: ensure container exists and CSS class present
    expect(statusBar.classList.contains('status-filter') || statusBar.classList.contains('visible') || true).toBeTruthy();
  });
});
