import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import {
  parseFrontmatter,
  archiveMemo,
  readRegistryAlias,
} from './TelegraphService';
import { createFlatWire, writeFlatWire, FlatWire } from './WireFactory';
import { PromptIndexService } from './PromptIndexService';

/**
 * @wildwest Copilot Chat participant — P7 (v0.22.0)
 *
 * Action-capable governance interface in the Copilot window.
 * All write operations (send, ack, archive) write to outbox/inbox dirs directly —
 * same scope rules as existing wildwest.* commands. Telegraph protocol is not bypassed.
 *
 * Commands:
 *   @wildwest inbox                — town inbox only (scope-enforced); per-wire [Archive] button
 *   @wildwest send <role> "<msg>"  — draft wire → preview → [Confirm Send] button
 *   @wildwest ack <timestamp>      — generate ack for that timestamp → [Send Ack] button
 *   @wildwest archive <filename>   — move wire from inbox to inbox/history
 *   @wildwest telegraph check      — 4-dir sweep (inbox, outbox, history, dead-letter)
 *   @wildwest board                — active branches
 *   @wildwest status               — identity, heartbeat, open wire count
 *   @wildwest help                 — command reference
 */

const PARTICIPANT_ID = 'wildwest.participant';

// Companion command IDs (registered in registerChatParticipant)
const CMD_CONFIRM_SEND = 'wildwest.participant.confirmSend';
const CMD_ARCHIVE_WIRE = 'wildwest.participant.archiveMemo';
const CMD_CONFIRM_ACK  = 'wildwest.participant.confirmAck';

export function registerChatParticipant(
  context: vscode.ExtensionContext,
  outputChannel: vscode.OutputChannel,
  promptIndex?: PromptIndexService,
): void {
  // ── Companion commands (needed before participant so buttons work) ──────────

  context.subscriptions.push(
    vscode.commands.registerCommand(CMD_CONFIRM_SEND, async (args: {
      wire: FlatWire; flatDir: string | null; outboxDir: string;
    }) => {
      try {
        // Primary: flat/ (territory SSOT)
        if (args.flatDir) {
          writeFlatWire(args.wire, args.flatDir);
        }
        // Secondary: workspace outbox for inbox delivery
        fs.mkdirSync(args.outboxDir, { recursive: true });
        fs.writeFileSync(
          path.join(args.outboxDir, args.wire.filename),
          JSON.stringify(args.wire, null, 2),
          'utf8',
        );
        vscode.window.showInformationMessage(`Wild West: wire sent → ${args.wire.filename}`);
        outputChannel.appendLine(`[WildwestParticipant] sent wire: ${args.wire.filename}`);
      } catch (err) {
        vscode.window.showErrorMessage(`Wild West: send failed — ${err}`);
      }
    }),

    vscode.commands.registerCommand(CMD_ARCHIVE_WIRE, async (args: {
      inboxDir: string; filename: string;
    }) => {
      try {
        archiveMemo(path.join(args.inboxDir, args.filename), path.join(args.inboxDir, 'history'));
        vscode.window.showInformationMessage(`Wild West: archived → ${args.filename}`);
        outputChannel.appendLine(`[WildwestParticipant] archived wire: ${args.filename}`);
      } catch (err) {
        vscode.window.showErrorMessage(`Wild West: archive failed — ${err}`);
      }
    }),

    vscode.commands.registerCommand(CMD_CONFIRM_ACK, async (args: {
      wire: FlatWire; flatDir: string | null; outboxDir: string;
    }) => {
      try {
        if (args.flatDir) {
          writeFlatWire(args.wire, args.flatDir);
        }
        fs.mkdirSync(args.outboxDir, { recursive: true });
        fs.writeFileSync(
          path.join(args.outboxDir, args.wire.filename),
          JSON.stringify(args.wire, null, 2),
          'utf8',
        );
        vscode.window.showInformationMessage(`Wild West: ack sent → ${args.wire.filename}`);
        outputChannel.appendLine(`[WildwestParticipant] sent ack: ${args.wire.filename}`);
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
        case 'prompts':
          await handlePrompts(rawPrompt, tokens.slice(1).join(' '), promptIndex, stream);
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
  const townFlatDir = path.join(wwRoot, 'telegraph', 'flat');

  // Scope enforcement: town workspace reads only its own wire cache.
  // Cross-scope (county) wire reads are blocked for town identity (Rule 14).
  const registryPath = path.join(wwRoot, 'registry.json');
  let workspaceScope: string | null = null;
  try {
    const reg = JSON.parse(fs.readFileSync(registryPath, 'utf8')) as Record<string, unknown>;
    workspaceScope = (reg['scope'] as string) ?? null;
  } catch { /* registry unreadable — default to town-only */ }

  const townWires = listWires(townFlatDir);

  if (workspaceScope !== 'town') {
    // Non-town workspace: also sweep county wire cache
    const countyRoot = findCountyRootFromWwDir(wwRoot);
    const countyFlatDir = countyRoot ? path.join(countyRoot, '.wildwest', 'telegraph', 'flat') : null;
    const countyWires = countyFlatDir ? listWires(countyFlatDir) : [];

    const total = townWires.length + countyWires.length;
    if (total === 0) {
      stream.markdown('**All wires processed.** Nothing to process.');
      return;
    }

    if (countyWires.length > 0) {
      stream.markdown(`**County wire cache** — ${countyWires.length} wire(s):\n\n`);
      for (const wire of countyWires) {
        const subject = extractSubject(path.join(countyFlatDir!, wire), wire);
        stream.markdown(`- \`${wire}\`  \n  ${subject}\n`);
        stream.button({ command: CMD_ARCHIVE_WIRE, title: 'Archive', arguments: [{ inboxDir: countyFlatDir!, filename: wire }] });
        stream.markdown('\n');
      }
    }
  } else if (townWires.length === 0) {
    stream.markdown('**Wire cache empty.** Nothing to process.');
    return;
  }

  if (townWires.length > 0) {
    stream.markdown(`**Town wire cache** — ${townWires.length} wire(s):\n\n`);
    for (const wire of townWires) {
      const subject = extractSubject(path.join(townFlatDir, wire), wire);
      stream.markdown(`- \`${wire}\`  \n  ${subject}\n`);
      stream.button({ command: CMD_ARCHIVE_WIRE, title: 'Archive', arguments: [{ inboxDir: townFlatDir, filename: wire }] });
      stream.markdown('\n');
    }
  }
}

async function handleSend(wwRoot: string, rawPrompt: string, stream: vscode.ChatResponseStream): Promise<void> {
  // Parse: send <role> "<message>"  or  send <role> <message without quotes>
  const match = rawPrompt.match(/^send\s+(\S+)\s+"([^"]+)"/i)
    ?? rawPrompt.match(/^send\s+(\S+)\s+(.+)/i);
  if (!match) {
    stream.markdown('Usage: `@wildwest send <role> "<message>"`\n\nExample: `@wildwest send CD "ack 1507Z wire — resolved"`');
    return;
  }

  const toRole = match[1];
  const body = match[2].trim();
  // Build sender in Rule-14 format: Role(alias) for multi-town county.
  const alias = readRegistryAlias(wwRoot);
  const identitySetting = vscode.workspace.getConfiguration('wildwest').get<string>('identity') ?? '';
  const roleMatch = identitySetting.match(/^([A-Za-z]+)/);
  const role = roleMatch ? roleMatch[1] : 'TM';
  const senderAlias = alias ? `${role}(${alias})` : (identitySetting || 'TM');
  const outboxDir = path.join(wwRoot, 'telegraph', 'outbox');
  const subject = body.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9-]/g, '').toLowerCase().slice(0, 40);
  const flatDir = resolveFlatDir();

  const wire = createFlatWire({ from: senderAlias, to: toRole, type: 'status-update', subject, body, status: 'sent' });

  stream.markdown(`**Draft wire** — preview before sending:\n\n`);
  stream.markdown('```json\n' + JSON.stringify(wire, null, 2) + '\n```\n\n');
  stream.markdown(`Filename: \`${wire.filename}\`\n\n`);
  stream.button({ command: CMD_CONFIRM_SEND, title: 'Confirm Send', arguments: [{ wire, flatDir, outboxDir }] });
}

async function handleAck(wwRoot: string, timestampArg: string, stream: vscode.ChatResponseStream): Promise<void> {
  if (!timestampArg) {
    stream.markdown('Usage: `@wildwest ack <timestamp>`\n\nExample: `@wildwest ack 1507Z`');
    return;
  }

  // Find wire matching the timestamp in local flat cache
  const flatDir = path.join(wwRoot, 'telegraph', 'flat');
  const wires = listWires(flatDir);
  const matched = wires.find((f) => f.includes(timestampArg));

  if (!matched) {
    stream.markdown(`No wire found matching \`${timestampArg}\` in local wire cache.`);
    return;
  }

  const matchedPath = path.join(flatDir, matched);
  const frontmatter = parseFrontmatter(matchedPath);
  const originalFrom = (frontmatter['from'] as string) ?? 'unknown';
  const originalSubject = (frontmatter['subject'] as string) ?? matched;

  // Build sender in Rule-14 format: Role(alias) for multi-town county.
  const alias = readRegistryAlias(wwRoot);
  const identitySetting = vscode.workspace.getConfiguration('wildwest').get<string>('identity') ?? '';
  const roleMatch = identitySetting.match(/^([A-Za-z]+)/);
  const role = roleMatch ? roleMatch[1] : 'TM';
  const senderAlias = alias ? `${role}(${alias})` : (identitySetting || 'TM');
  const outboxDir = path.join(wwRoot, 'telegraph', 'outbox');
  const ackSubject = `ack-${timestampArg}-${originalSubject}`.slice(0, 60).replace(/\s+/g, '-');
  const ackBody = `Ack — your ${timestampArg} wire (${originalSubject}) received and processed.\n\n${senderAlias}`;
  const localFlatDir = resolveFlatDir();

  const wire = createFlatWire({
    from: senderAlias,
    to: originalFrom,
    type: 'ack',
    subject: ackSubject,
    body: ackBody,
    status: 'sent',
    re: matched,
    original_wire: matched,
  });

  stream.markdown(`**Ack wire** — \`${matched}\`:\n\n`);
  stream.markdown('```json\n' + JSON.stringify(wire, null, 2) + '\n```\n\n');
  stream.button({ command: CMD_CONFIRM_ACK, title: 'Send Ack', arguments: [{ wire, flatDir: localFlatDir, outboxDir }] });
}

async function handleArchive(wwRoot: string, filenameArg: string, stream: vscode.ChatResponseStream): Promise<void> {
  const flatDir = path.join(wwRoot, 'telegraph', 'flat');
  const wires = listWires(flatDir);
  const matched = wires.find((f) => f === filenameArg || f.includes(filenameArg));

  if (!matched) {
    stream.markdown(`No wire found matching \`${filenameArg}\` in local wire cache.\n\nUsage: \`@wildwest archive <filename-or-partial>\``);
    return;
  }

  const archiveDir = path.join(wwRoot, 'telegraph', 'flat');
  stream.markdown(`Archive \`${matched}\`?\n\n`);
  stream.button({ command: CMD_ARCHIVE_WIRE, title: 'Archive', arguments: [{ inboxDir: archiveDir, filename: matched }] });
}

async function handleTelegraphCheck(wwRoot: string, stream: vscode.ChatResponseStream): Promise<void> {
  const telegraphDir = path.join(wwRoot, 'telegraph');
  const _isMd = (f: string) => f.endsWith('.md') && !f.startsWith('.');

  const count = (dir: string, pred: (f: string) => boolean): number => {
    if (!fs.existsSync(dir)) return 0;
    try { return fs.readdirSync(dir).filter(pred).length; } catch { return 0; }
  };

  const flatDir   = path.join(telegraphDir, 'flat');
  const outboxDir  = path.join(telegraphDir, 'outbox');
  const historyDir = path.join(outboxDir, 'history');

  const inbox      = count(flatDir,   (f) => (f.endsWith('.json') || f.endsWith('.md')) && !f.startsWith('!'));
  const outbox     = count(outboxDir,  (f) => (f.endsWith('.json') || f.endsWith('.md')) && !f.startsWith('!'));
  const history    = count(historyDir, (f) => (f.endsWith('.json') || f.endsWith('.md')) && !f.startsWith('.'));
  const deadLetter = count(outboxDir, (f) => f.startsWith('!'));

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
      const identity = data.identity ?? data.actor ?? '';
      stream.markdown(`- **${branch}** — \`${state}\`${identity ? `  (${identity})` : ''}\n`);
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
    const inboxCount = listWires(path.join(wwRoot, 'telegraph', 'flat')).length;
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

async function handlePrompts(
  rawPrompt: string,
  queryTokens: string,
  promptIndex: PromptIndexService | undefined,
  stream: vscode.ChatResponseStream,
): Promise<void> {
  if (!promptIndex) {
    stream.markdown('Prompt index not available. Run **Wild West: Regenerate Prompts** from the sidebar first.');
    return;
  }

  const index = promptIndex.getIndex();
  if (!index) {
    stream.markdown('Prompt index not built yet. Run **Wild West: Regenerate Prompts** from the sidebar.');
    return;
  }

  // `@wildwest prompts` with no query → show analytics
  // `@wildwest prompts <query>` → search
  const query = queryTokens.trim();

  if (!query) {
    const a = index.analytics;
    const byTool = Object.entries(a.by_tool).map(([t, n]) => `${t}: ${n}`).join(', ');
    const byScope = Object.entries(a.by_scope).map(([s, n]) => `${s}: ${n}`).join(', ');
    const byKind = Object.entries(a.by_kind ?? {})
      .sort(([, a], [, b]) => b - a)
      .slice(0, 6)
      .map(([kind, n]) => `${kind}: ${n}`)
      .join(', ');
    const violations = Object.entries(a.framework_violations ?? {})
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([flag, n]) => `${flag}: ${n}`)
      .join(', ');
    const topAliases = Object.entries(a.by_scope_alias)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([alias, n]) => `${alias}: ${n}`)
      .join(', ');

    stream.markdown(
      `**Prompt Index** — ${a.unique_total.toLocaleString()} unique · ${a.raw_total.toLocaleString()} raw · ${a.filtered_noise.toLocaleString()} noise filtered\n\n` +
      `| Dimension | Breakdown |\n|---|---|\n` +
      `| By tool | ${byTool} |\n` +
      `| By scope | ${byScope} |\n` +
      `| By kind | ${byKind || '—'} |\n` +
      `| Top aliases | ${topAliases || '—'} |\n` +
      `| Framework flags | ${violations || '—'} |\n\n` +
      `_Use \`@wildwest prompts <query>\` to search. Use \`@wildwest prompts scope:<alias> <query>\` to filter by workspace._`,
    );
    return;
  }

  // Parse optional `scope:<alias>` prefix
  let scopeAlias: string | undefined;
  let searchQuery = query;
  const scopeMatch = query.match(/^scope:(\S+)\s*(.*)/i);
  if (scopeMatch) {
    scopeAlias = scopeMatch[1];
    searchQuery = scopeMatch[2] ?? '';
  }

  const results = promptIndex.search(searchQuery, scopeAlias, 15, {
    includeGlobalFallback: false,
    includeScopeLineage: true,
  });
  if (results.length === 0) {
    stream.markdown(`No prompts found for **"${searchQuery}"**${scopeAlias ? ` in scope \`${scopeAlias}\`` : ''}.`);
    return;
  }

  stream.markdown(
    `**${results.length} prompt${results.length > 1 ? 's' : ''}** matching \`${searchQuery}\`${scopeAlias ? ` · scope \`${scopeAlias}\`` : ''}:\n\n`,
  );
  for (const p of results) {
    const preview = p.content.length > 120 ? p.content.slice(0, 120) + '…' : p.content;
    const freqTag = p.frequency > 1 ? ` · ×${p.frequency}` : '';
    const compliance = p.framework_compliant ? 'framework-ok' : `flags: ${p.compliance_flags.join(', ')}`;
    stream.markdown(
      `**score ${p.score.toFixed(2)}${freqTag}** · ${p.kind} · ${compliance} · ${p.tool} · \`${p.scope_alias || p.recorder_scope}\` · ${p.last_used.slice(0, 10)}\n` +
      `> ${preview.replace(/\n/g, ' ')}\n\n---\n\n`,
    );
  }
}

async function handleHelp(stream: vscode.ChatResponseStream): Promise<void> {
  stream.markdown(
    '**@wildwest** — Wild West governance\n\n' +
    '| Command | Description |\n|---|---|\n' +
    '| `@wildwest inbox` | County + town inbox sweep; [Archive] per wire |\n' +
    '| `@wildwest send <role> "<msg>"` | Draft wire → preview → [Confirm Send] |\n' +
    '| `@wildwest ack <timestamp>` | Generate ack for that wire → [Send Ack] |\n' +
    '| `@wildwest archive <filename>` | Move inbox wire to history |\n' +
    '| `@wildwest telegraph check` | 4-dir sweep: inbox, outbox, history, dead-letter |\n' +
    '| `@wildwest board` | Active branches from .wildwest/board/ |\n' +
    '| `@wildwest status` | Identity, heartbeat, open wire count |\n' +
    '| `@wildwest prompts` | Prompt index analytics |\n' +
    '| `@wildwest prompts <query>` | Search past prompts; supports `scope:<alias>` prefix |\n' +
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

function listWires(dir: string): string[] {
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

function resolveFlatDir(): string | null {
  const cfg = vscode.workspace.getConfiguration('wildwest');
  let worldRoot = cfg.get<string>('worldRoot') ?? '~/wildwest';
  if (worldRoot.startsWith('~')) {
    worldRoot = path.join(os.homedir(), worldRoot.slice(1));
  }
  const flatDir = path.join(worldRoot, 'telegraph', 'flat');
  return fs.existsSync(flatDir) ? flatDir : null;
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
