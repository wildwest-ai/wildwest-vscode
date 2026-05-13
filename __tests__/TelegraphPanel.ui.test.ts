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
  let html: string;

  beforeAll(() => {
    html = extractHtmlFromSource();
  });

  test('header contains theme-aware SVG icon and title (string checks)', () => {
    // icon may be inlined SVG, external <img>, or injected via ${iconMarkup} placeholder
    const hasIcon = html.includes('<svg') || html.includes('<img') || html.includes('${iconMarkup}');
    expect(hasIcon).toBeTruthy();
    expect(html.includes('class="title"')).toBeTruthy();
    expect(html.includes('<h2>Telegraph</h2>')).toBeTruthy();
  });

  test('status filter container exists', () => {
    expect(html.includes('id="statusFilter"')).toBeTruthy();
  });
});
