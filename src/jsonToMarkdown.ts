import fs from 'fs';
import path from 'path';

interface ResponseItem {
  kind: string;
  value?: string;
}

interface SessionRequest {
  message: { text: string };
  response: ResponseItem[];
  timestamp?: number;
}

export interface ExportJson {
  exportedAt?: string;
  github_userid?: string;
  user_timezone_offset?: string; // e.g. "-05:00"
  totalPrompts?: number;
  totalLogEntries?: number;
  sourceSession?: {
    customTitle?: string;
    sessionId?: string;
    creationDate?: number;
    lastMessageDate?: number;
    requests?: SessionRequest[];
  };
  prompts?: Array<{
    prompt: string;
    timestamp?: number;
    response?: string;
    hasSeen?: boolean;
    logCount?: number;
    logs?: string[];
  }>;
}

function parseArgs() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error('Usage: ts-node src/jsonToMarkdown.ts <input.json> [--out <output.md>]');
    process.exit(1);
  }
  const input = args[0];
  let outPath: string | undefined;
  for (let i = 1; i < args.length; i++) {
    const a = args[i];
    if (a === '--out') {
      outPath = args[i + 1];
      i++;
    }
  }
  return { input, outPath };
}

function ensureInput(p: string): string {
  const abs = path.resolve(p);
  if (!fs.existsSync(abs)) {
    throw new Error(`Input file not found: ${abs}`);
  }
  return abs;
}

function safeText(t: unknown): string {
  if (t === undefined || t === null) return '';
  if (typeof t !== 'string') return String(t);
  return t;
}

function formatUtc(ms?: number): string {
  if (!ms && ms !== 0) return 'N/A';
  return new Date(ms).toISOString();
}

function formatWithOffset(ms?: number, tz?: string): string {
  if (!ms && ms !== 0) return 'N/A';
  const d = new Date(ms);
  // Use LOCAL time components (not UTC) for clarity
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  const SSS = String(d.getMilliseconds()).padStart(3, '0');
  const off = tz ? `UTC${tz}` : 'UTC±00:00';
  return `${y}-${m}-${day} ${hh}:${mm}:${ss}.${SSS} ${off}`;
}

function makeOutPath(inputAbs: string, requested?: string): string {
  if (requested) return path.resolve(requested);
  const dir = path.dirname(inputAbs);
  const base = path.basename(inputAbs, path.extname(inputAbs));
  return path.join(dir, `${base}.md`);
}

function extractResponseFromRequest(req?: SessionRequest): string {
  if (!req || !Array.isArray(req.response)) return '';
  let out = '';
  for (const r of req.response) {
    if (typeof r.value === 'string') out += r.value;
  }
  return out.trim();
}

export function generateMarkdown(data: ExportJson, inputAbs: string): string {
  const lines: string[] = [];

  const title = safeText(data.sourceSession?.customTitle) || 'Chat Export';
  lines.push(`# ${title}`);
  lines.push('');

  // Metadata
  lines.push('**Metadata**');
  lines.push(`- **Source file:** ${path.relative(process.cwd(), inputAbs)}`);
  if (data.exportedAt) lines.push(`- **Exported At (UTC):** ${safeText(data.exportedAt)}`);
  if (data.github_userid) lines.push(`- **GitHub User:** ${safeText(data.github_userid)}`);
  if (data.user_timezone_offset) lines.push(`- **Timezone Offset:** UTC${safeText(data.user_timezone_offset)}`);
  if (data.totalPrompts !== undefined) lines.push(`- **Total Prompts:** ${data.totalPrompts}`);
  if (data.totalLogEntries !== undefined) lines.push(`- **Total Log Entries:** ${data.totalLogEntries}`);
  if (data.sourceSession?.sessionId) lines.push(`- **Session ID:** ${safeText(data.sourceSession?.sessionId)}`);
  if (data.sourceSession?.creationDate !== undefined) lines.push(`- **Session Created (UTC):** ${formatUtc(data.sourceSession?.creationDate)}`);
  if (data.sourceSession?.lastMessageDate !== undefined) lines.push(`- **Last Message (UTC):** ${formatUtc(data.sourceSession?.lastMessageDate)}`);
  lines.push('');

  lines.push('## Transcript');
  lines.push('');
  lines.push('```text');

  const prompts = data.prompts || [];
  const requests = data.sourceSession?.requests || [];
  const tz = data.user_timezone_offset || '';
  const userid = safeText(data.github_userid) || 'User';

  for (let i = 0; i < prompts.length; i++) {
    const p = prompts[i];
    const req = requests[i];
    const userTs = p.timestamp ?? req?.timestamp ?? undefined;
    const userLine = `${formatWithOffset(userTs, tz)} ${userid}: ${safeText(p.prompt)}`;
    lines.push(userLine);
    lines.push('');
    lines.push('');
    lines.push('---');
    lines.push('');

    // Determine response: prefer prompt.response, else fallback to sourceSession.requests[i]
    let resp = safeText(p.response);
    if (!resp) resp = extractResponseFromRequest(req);
    if (resp) {
      const respTs = typeof userTs === 'number' ? userTs + 1000 : undefined; // +1s
      const respLine = `${formatWithOffset(respTs, tz)} GitHub Copilot: ${resp}`;
      // Insert response before the separator for better readability
      lines.splice(lines.length - 3, 0, respLine, '');
    }
  }

  lines.push('```');
  lines.push('');
  return lines.join('\n');
}

export function convertJsonFileToMarkdown(input: string, outPath?: string): string {
  const inputAbs = ensureInput(input);

  const raw = fs.readFileSync(inputAbs, 'utf8');
  let json: ExportJson;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    throw new Error(`Failed to parse JSON: ${e}`);
  }

  const md = generateMarkdown(json, inputAbs);
  const outAbs = makeOutPath(inputAbs, outPath);
  fs.writeFileSync(outAbs, md, 'utf8');
  return outAbs;
}

function main() {
  const { input, outPath } = parseArgs();
  try {
    const outAbs = convertJsonFileToMarkdown(input, outPath);
    console.log(`✓ Markdown saved: ${outAbs}`);
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
