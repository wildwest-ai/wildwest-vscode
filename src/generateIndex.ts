import fs from 'fs';
import path from 'path';
import { ExportJson } from './jsonToMarkdown';

interface IndexRow {
  title: string;
  dateMs: number;
  promptCount: number;
  jsonFile: string;
  mdFile?: string;
  size: string;
}

function formatUtc(ms: number): string {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  const ss = String(d.getUTCSeconds()).padStart(2, '0');
  return `${y}-${m}-${day} ${hh}:${mm}:${ss} UTC`;
}

function formatSize(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  return `${size.toFixed(1)}${units[unitIndex]}`;
}

function escapePipes(text: string): string {
  return text.replace(/\|/g, '|');
}

function pickTitle(data: ExportJson, fallback: string): string {
  if (data.sourceSession?.customTitle) return data.sourceSession.customTitle;
  if (data.prompts && data.prompts.length > 0 && data.prompts[0].prompt) return data.prompts[0].prompt;
  const reqText = data.sourceSession?.requests?.[0]?.message?.text;
  if (reqText) return reqText;
  return fallback;
}

function pickTimestamp(data: ExportJson, jsonStat: fs.Stats): number {
  if (typeof data.sourceSession?.lastMessageDate === 'number') return data.sourceSession.lastMessageDate;
  if (typeof data.sourceSession?.creationDate === 'number') return data.sourceSession.creationDate;
  if (data.exportedAt) {
    const parsed = Date.parse(data.exportedAt);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return jsonStat.mtimeMs;
}

function pickPromptCount(data: ExportJson): number {
  if (typeof data.totalPrompts === 'number') return data.totalPrompts;
  if (Array.isArray(data.prompts)) return data.prompts.length;
  if (Array.isArray(data.sourceSession?.requests)) return data.sourceSession.requests.length;
  return 0;
}

function readJsonSafe(filePath: string): ExportJson | null {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw) as ExportJson;
  } catch {
    return null;
  }
}

export function generateIndex(exportPath: string, stagedDirOverride?: string): string {
  const stagedDir = stagedDirOverride ?? path.join(exportPath, 'staged');
  if (!fs.existsSync(stagedDir)) {
    throw new Error(`Staged directory not found: ${stagedDir}`);
  }

  const files = fs.readdirSync(stagedDir);
  const jsonFiles = files.filter((f) => f.endsWith('.json') && !f.startsWith('.'));

  const rows: IndexRow[] = [];

  for (const jsonFile of jsonFiles) {
    const jsonPath = path.join(stagedDir, jsonFile);
    const jsonStat = fs.statSync(jsonPath);
    const data = readJsonSafe(jsonPath);
    if (!data) {
      // Skip malformed entries to avoid blocking index generation
      continue;
    }

    const mdPath = jsonPath.replace(/\.json$/, '.md');
    const hasMd = fs.existsSync(mdPath);
    const mdStat = hasMd ? fs.statSync(mdPath) : undefined;

    const title = pickTitle(data, path.basename(jsonFile, '.json'));
    const ts = pickTimestamp(data, jsonStat);
    const promptCount = pickPromptCount(data);
    const sizeBytes = mdStat?.size ?? jsonStat.size;

    rows.push({
      title,
      dateMs: ts,
      promptCount,
      jsonFile,
      mdFile: hasMd ? path.basename(mdPath) : undefined,
      size: formatSize(sizeBytes),
    });
  }

  if (rows.length === 0) {
    throw new Error('No JSON exports found in staged directory');
  }

  rows.sort((a, b) => b.dateMs - a.dateMs);

  const lines: string[] = [];
  lines.push('# Wild West Session Index');
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push('');
  lines.push('| Date (UTC) | Title | Prompts | Files | Size |');
  lines.push('| --- | --- | --- | --- | --- |');

  for (const row of rows) {
    const date = formatUtc(row.dateMs);
    const filesCellParts = [`[JSON](${row.jsonFile})`];
    if (row.mdFile) {
      filesCellParts.push(`[MD](${row.mdFile})`);
    }
    const filesCell = filesCellParts.join(' · ');
    lines.push(`| ${date} | ${escapePipes(row.title)} | ${row.promptCount} | ${filesCell} | ${row.size} |`);
  }

  const indexPath = path.join(stagedDir, 'INDEX.md');
  fs.writeFileSync(indexPath, lines.join('\n'), 'utf8');
  return indexPath;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const exportPath = args[0] ? path.resolve(args[0]) : process.cwd();
  return exportPath;
}

function main() {
  try {
    const exportPath = parseArgs();
    const out = generateIndex(exportPath);
    console.log(`✓ Index generated at: ${out}`);
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
