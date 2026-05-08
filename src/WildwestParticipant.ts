import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import {
  telegraphTimestamp,
  parseFrontmatter,
  archiveMemo,
  readRegistryAlias,
} from './TelegraphService';

/**
 * @wildwest Copilot Chat participant — P7 (v0.22.0)
 *
 * Action-capable governance interface in the Copilot window.
 * All write operations (send, ack, archive) write to outbox/inbox dirs directly —
 * same scope rules as existing wildwest.* commands. Telegraph protocol is not bypassed.
 *
 * Commands:
 *   @wildwest inbox                — county + town inbox sweep; per-memo [Archive] button
 *   @wildwest send <role> "<msg>"  — draft memo → preview → [Confirm Send] button
 *   @wildwest ack <timestamp>      — generate ack for that timestamp → [Send Ack] button
 *   @wildwest archive <filename>   — move memo from inbox to inbox/history
 *   @wildwest telegraph check      — 4-dir sweep (inbox, outbox, history, dead-letter)
 *   @wildwest board                — active branches
 *   @wildwest status               — identity, heartbeat, open memo count
 *   @wildwest help                 — command reference
 */

const PARTICIPANT_ID = 'wildwest.participant';

// Companion command IDs (registered in registerChatParticipant)
const CMD_CONFIRM_SEND = 'wildwest.participant.confirmSend';
const CMD_ARCHIVE_MEMO = 'wildwest.participant.archiveMemo';
const CMD_CONFIRM_ACK  = 'wildwest.participant.confirmAck';

export function registerChatParticipant(
  context: vscode.ExtensionContext,
  outputChannel: vscode.OutputChannel,
): void {
  // ── Companion commands (needed before participant so buttons work) ──────────

  context.subscriptions.push(
    vscode.commands.registerCommand(CMD_CONFIRM_SEND, async (args: {
      outboxDir: string; filename: string; content: string;
    }) => {
      try {
        fs.mkdirSync(args.outboxDir, { recursive: true });
        fs.writeFileSync(path.join(args.outboxDir, args.filename), args.content, 'utf8');
        vscode.window.showInformationMessage(`Wild West: memo sent → ${args.filename}`);
        outputChannel.appendLine(`[WildwestParticipant] sent memo: ${args.filename}`);
      } catch (err) {
        vscode.window.showErrorMessage(`Wild West: send failed — ${err}`);
      }
    }),

    vscode.commands.registerCommand(CMD_ARCHIVE_MEMO, async (args: {
      inboxDir: string; filename: string;
    }) => {
      try {
        archiveMemo(path.join(args.inboxDir, args.filename), path.join(args.inboxDir, 'history'));
        vscode.window.showInformationMessage(`Wild West: archived → ${args.filename}`);
        outputChannel.appendLine(`[WildwestParticipant] archived memo: ${args.filename}`);
      } catch (err) {
        vscode.window.showErrorMessage(`Wild West: archive failed — ${err}`);
      }
    }),

    vscode.commands.registerCommand(CMD_CONFIRM_ACK, async (args: {
      outboxDir: string; filename: string; content: string;
    }) => {
      try {
        fs.mkdirSync(args.outboxDir, { recursive: true });
        fs.writeFileSync(path.join(args.outboxDir, args.filename), args.content, 'utf8');
        vscode.window.showInformationMessage(`Wild West: ack sent → ${args.filename}`);
        outputChannel.appendLine(`[WildwestParticipant] sent ack: ${args.filename}`);
      } catch (err) {
        vscode.window.showErrorMessage(`Wild West: ack send failed — ${err}`);
      }
    }),
  );

  // ── Chat participant ────────────────────────────────────────────────────────

  const participant = vscode.chat.createChatParticipant(
    PARTICIPANT_ID,
    async (request, _chatContext, stream, _token) => {
      const rawPrompt = request.prompt.trim();
      const cmd = request.command?.toLowerCase().trim() ?? '';
      const tokens = rawPrompt.split(/\s+/);
      const intent = cmd || (tokens[0]?.toLowerCase() ?? '');

      outputChannel.appendLine(`[WildwestParticipant] intent: "${intent}" prompt: "${rawPrompt}"`);

      const wwRoot = resolveWildwestDir();
      if (!wwRoot) {
        stream.markdown('No `.wildwest/` directory found in the current workspace. Run **Wild West: Init Town** first.');
        return;
      }

      switch (intent) {
        case 'inbox':
          await handleInbox(wwRoot, stream);
          break;
        case 'send':
          await handleSend(wwRoot, rawPrompt, stream);
          break;
        case 'ack':
          await handleAck(wwRoot, tokens[1] ?? '', stream);
          break;
        case 'archive':
          await handleArchive(wwRoot, tokens.slice(1).join(' '), stream);
          break;
        case 'telegraph':
          await handleTelegraphCheck(wwRoot, stream);
          break;
        case 'board':
          await handleBoard(wwRoot, stream);
          break;
        case 'status':
          await handleStatus(wwRoot, stream);
          break;
        default:
          await handleHelp(stream);
          break;
      }
    },
  );

  participant.iconPath = new vscode.ThemeIcon('radio-tower');
  context.subscriptions.push(participant);
  outputChannel.appendLine('[WildwestParticipant] registered @wildwest chat participant (P7)');
}

// ── Handlers ──────────────────────────────────────────────────────────────────

async function handleInbox(wwRoot: string, stream: vscode.ChatResponseStream): Promise<void> {
  const townInboxDir = path.join(wwRoot, 'telegraph', 'inbox');
  const countyRoot = findCountyRootFromWwDir(wwRoot);
  const countyInboxDir = countyRoot ? path.join(countyRoot, '.wildwest', 'telegraph', 'inbox') : null;

  const townMemos = listMemos(townInboxDir);
  const countyMemos = countyInboxDir ? listMemos(countyInboxDir) : [];

  const total = townMemos.length + countyMemos.length;
  if (total === 0) {
    stream.markdown('**All inboxes empty.** Nothing to process.');
    return;
  }

  if (countyMemos.length > 0) {
    stream.markdown(`**County inbox** — ${countyMemos.length} memo(s):\n\n`);
    for (const memo of countyMemos) {
      const subject = extractSubject(path.join(countyInboxDir!, memo), memo);
      stream.markdown(`- \`${memo}\`  \n  ${subject}\n`);
      stream.button({ command: CMD_ARCHIVE_MEMO, title: 'Archive', arguments: [{ inboxDir: countyInboxDir!, filename: memo }] });
      stream.markdown('\n');
    }
  }

  if (townMemos.length > 0) {
    stream.markdown(`**Town inbox** — ${townMemos.length} memo(s):\n\n`);
    for (const memo of townMemos) {
      const subject = extractSubject(path.join(townInboxDir, memo), memo);
      stream.markdown(`- \`${memo}\`  \n  ${subject}\n`);
      stream.button({ command: CMD_ARCHIVE_MEMO, title: 'Archive', arguments: [{ inboxDir: townInboxDir, filename: memo }] });
      stream.markdown('\n');
    }
  }
}

async function handleSend(wwRoot: string, rawPrompt: string, stream: vscode.ChatResponseStream): Promise<void> {
  // Parse: send <role> "<message>"  or  send <role> <message without quotes>
  const match = rawPrompt.match(/^send\s+(\S+)\s+"([^"]+)"/i)
    ?? rawPrompt.match(/^send\s+(\S+)\s+(.+)/i);
  if (!match) {
    stream.markdown('Usage: `@wildwest send <role> "<message>"`\n\nExample: `@wildwest send CD "ack 1507Z memo — resolved"`');
    return;
  }

  const toRole = match[1];
  const body = match[2].trim();
  const senderAlias = readRegistryAlias(wwRoot) ?? 'TM';
  const outboxDir = path.join(wwRoot, 'telegraph', 'outbox');
  const now = new Date();
  const ts = telegraphTimestamp(now);
  const subject = body.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9-]/g, '').toLowerCase().slice(0, 40);
  const filename = `${ts}-to-${toRole}-from-${senderAlias}--${subject}.md`;
  const content =
    `---\nto: ${toRole}\nfrom: ${senderAlias}\ndate: ${now.toISOString().slice(0, 16)}Z\nsubject: ${subject}\n---\n\n${body}\n\n${senderAlias}\n`;

  stream.markdown(`**Draft memo** — preview before sending:\n\n`);
  stream.markdown('```\n' + content + '```\n\n');
  stream.markdown(`Filename: \`${filename}\`\n\n`);
  stream.button({ command: CMD_CONFIRM_SEND, title: 'Confirm Send', arguments: [{ outboxDir, filename, content }] });
}

async function handleAck(wwRoot: string, timestampArg: string, stream: vscode.ChatResponseStream): Promise<void> {
  if (!timestampArg) {
    stream.markdown('Usage: `@wildwest ack <timestamp>`\n\nExample: `@wildwest ack 1507Z`');
    return;
  }

  // Find memo matching the timestamp in town inbox
  const inboxDir = path.join(wwRoot, 'telegraph', 'inbox');
  const memos = listMemos(inboxDir);
  const matched = memos.find((f) => f.includes(timestampArg));

  if (!matched) {
    stream.markdown(`No memo found matching \`${timestampArg}\` in inbox.`);
    return;
  }

  const frontmatter = parseFrontmatter(path.join(inboxDir, matched));
  const originalFrom = (frontmatter['from'] as string) ?? 'unknown';
  const originalSubject = (frontmatter['subject'] as string) ?? matched;

  const senderAlias = readRegistryAlias(wwRoot) ?? 'TM';
  const outboxDir = path.join(wwRoot, 'telegraph', 'outbox');
  const now = new Date();
  const ts = telegraphTimestamp(now);
  const ackSubject = `ack-${timestampArg}-${originalSubject}`.slice(0, 60).replace(/\s+/g, '-');
  const filename = `${ts}-to-${originalFrom}-from-${senderAlias}--${ackSubject}.md`;
  const content =
    `---\nto: ${originalFrom}\nfrom: ${senderAlias}\ndate: ${now.toISOString().slice(0, 16)}Z\nsubject: ${ackSubject}\n---\n\n` +
    `Ack — your ${timestampArg} memo (${originalSubject}) received and processed.\n\n${senderAlias}\n`;

  stream.markdown(`**Ack memo** — \`${matched}\`:\n\n`);
  stream.markdown('```\n' + content + '```\n\n');
  stream.button({ command: CMD_CONFIRM_ACK, title: 'Send Ack', arguments: [{ outboxDir, filename, content }] });
}

async function handleArchive(wwRoot: string, filenameArg: string, stream: vscode.ChatResponseStream): Promise<void> {
  const inboxDir = path.join(wwRoot, 'telegraph', 'inbox');
  const memos = listMemos(inboxDir);
  const matched = memos.find((f) => f === filenameArg || f.includes(filenameArg));

  if (!matched) {
    stream.markdown(`No memo found matching \`${filenameArg}\` in inbox.\n\nUsage: \`@wildwest archive <filename-or-partial>\``);
    return;
  }

  stream.markdown(`Archive \`${matched}\`?\n\n`);
  stream.button({ command: CMD_ARCHIVE_MEMO, title: 'Archive', arguments: [{ inboxDir, filename: matched }] });
}

async function handleTelegraphCheck(wwRoot: string, stream: vscode.ChatResponseStream): Promise<void> {
  const telegraphDir = path.join(wwRoot, 'telegraph');
  const isMd = (f: string) => f.endsWith('.md') && !f.startsWith('.');

  const count = (dir: string, pred: (f: string) => boolean): number => {
    if (!fs.existsSync(dir)) return 0;
    try { return fs.readdirSync(dir).filter(pred).length; } catch { return 0; }
  };

  const inboxDir   = path.join(telegraphDir, 'inbox');
  const outboxDir  = path.join(telegraphDir, 'outbox');
  const historyDir = path.join(telegraphDir, 'history');

  const inbox      = count(inboxDir,   (f) => isMd(f) && !f.startsWith('!'));
  const outbox     = count(outboxDir,  (f) => isMd(f) && !f.startsWith('!'));
  const history    = count(historyDir, isMd);
  const deadLetter = count(inboxDir,   (f) => f.startsWith('!')) + count(outboxDir, (f) => f.startsWith('!'));

  stream.markdown('**Telegraph check**\n\n');
  stream.markdown(`| Dir | Count |\n|---|---|\n`);
  stream.markdown(`| inbox | ${inbox} |\n`);
  stream.markdown(`| outbox | ${outbox} |\n`);
  stream.markdown(`| history | ${history} |\n`);
  stream.markdown(`| dead-letter | ${deadLetter} |\n`);
}

async function handleBoard(wwRoot: string, stream: vscode.ChatResponseStream): Promise<void> {
  const boardDir = path.join(wwRoot, 'board', 'branches');
  if (!fs.existsSync(boardDir)) {
    stream.markdown('No `.wildwest/board/branches/` found. Board not initialized.');
    return;
  }
  const files = fs.readdirSync(boardDir).filter((f) => f.endsWith('.json'));
  if (files.length === 0) {
    stream.markdown('**Board is empty.** No tracked branches.');
    return;
  }
  stream.markdown(`**Board** — ${files.length} branch(es):\n\n`);
  for (const file of files.sort()) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(boardDir, file), 'utf8'));
      const state  = data.state  ?? '?';
      const branch = data.branch ?? file.replace('.json', '');
      const actor  = data.actor  ?? '';
      stream.markdown(`- **${branch}** — \`${state}\`${actor ? `  (${actor})` : ''}\n`);
    } catch {
      stream.markdown(`- \`${file}\` (unreadable)\n`);
    }
  }
}

async function handleStatus(wwRoot: string, stream: vscode.ChatResponseStream): Promise<void> {
  const registryPath = path.join(wwRoot, 'registry.json');
  if (!fs.existsSync(registryPath)) {
    stream.markdown('No `registry.json` found. Town not initialized.');
    return;
  }
  try {
    const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
    const beatPath = path.join(wwRoot, 'telegraph', '.last-beat');
    const lastBeat = fs.existsSync(beatPath) ? fs.readFileSync(beatPath, 'utf8').trim() : 'unknown';
    const inboxCount = listMemos(path.join(wwRoot, 'telegraph', 'inbox')).length;
    const boardDir = path.join(wwRoot, 'board', 'branches');
    const boardCount = fs.existsSync(boardDir)
      ? fs.readdirSync(boardDir).filter((f) => f.endsWith('.json')).length : 0;

    stream.markdown('**Town Status**\n\n');
    stream.markdown('| Field | Value |\n|---|---|\n');
    stream.markdown(`| Alias | \`${registry.alias ?? '—'}\` |\n`);
    stream.markdown(`| Scope | \`${registry.scope ?? '—'}\` |\n`);
    stream.markdown(`| wwuid | \`${registry.wwuid ?? '—'}\` |\n`);
    stream.markdown(`| Last heartbeat | \`${lastBeat}\` |\n`);
    stream.markdown(`| Inbox (open) | ${inboxCount} |\n`);
    stream.markdown(`| Board branches | ${boardCount} |\n`);
  } catch {
    stream.markdown('Failed to read registry.json.');
  }
}

async function handleHelp(stream: vscode.ChatResponseStream): Promise<void> {
  stream.markdown(
    '**@wildwest** — Wild West governance\n\n' +
    '| Command | Description |\n|---|---|\n' +
    '| `@wildwest inbox` | County + town inbox sweep; [Archive] per memo |\n' +
    '| `@wildwest send <role> "<msg>"` | Draft memo → preview → [Confirm Send] |\n' +
    '| `@wildwest ack <timestamp>` | Generate ack for that memo → [Send Ack] |\n' +
    '| `@wildwest archive <filename>` | Move inbox memo to history |\n' +
    '| `@wildwest telegraph check` | 4-dir sweep: inbox, outbox, history, dead-letter |\n' +
    '| `@wildwest board` | Active branches from .wildwest/board/ |\n' +
    '| `@wildwest status` | Identity, heartbeat, open memo count |\n' +
    '| `@wildwest help` | Show this help |\n',
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function resolveWildwestDir(): string | null {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders) return null;
  for (const folder of folders) {
    const candidate = path.join(folder.uri.fsPath, '.wildwest');
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function listMemos(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(
    (f) => f.endsWith('.md') && !f.startsWith('.') && !f.startsWith('!') && f !== 'history',
  ).sort();
}

function extractSubject(filePath: string, filename: string): string {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const yamlMatch = content.match(/^---[\s\S]*?^subject:\s*(.+)$/m);
    if (yamlMatch) return yamlMatch[1].trim();
    const parts = filename.replace('.md', '').split('--');
    if (parts.length > 1) return parts[parts.length - 1].replace(/-/g, ' ');
  } catch { /* ignore */ }
  return filename;
}

function findCountyRootFromWwDir(wwRoot: string): string | null {
  // wwRoot = /path/to/town/.wildwest — walk from town root
  const townRoot = path.dirname(wwRoot);
  let current = path.dirname(townRoot);
  const fsRoot = path.parse(current).root;
  while (current !== fsRoot) {
    const regPath = path.join(current, '.wildwest', 'registry.json');
    try {
      const reg = JSON.parse(fs.readFileSync(regPath, 'utf8')) as Record<string, unknown>;
      if (reg['scope'] === 'county') return current;
    } catch { /* not a ww root */ }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}


