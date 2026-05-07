import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

/**
 * @wildwest Copilot Chat participant — P3
 *
 * Queries Wild West governance state directly from Copilot Chat.
 *
 * Commands:
 *   @wildwest inbox      — list unprocessed telegraph inbox memos
 *   @wildwest board      — list active/open branches from .wildwest/board/branches/
 *   @wildwest status     — town identity + heartbeat + adapter status
 *   @wildwest help       — list available commands
 *
 * Uses the active workspace folder to locate .wildwest/.
 */

const PARTICIPANT_ID = 'wildwest.participant';

export function registerChatParticipant(
  context: vscode.ExtensionContext,
  outputChannel: vscode.OutputChannel,
): void {
  const participant = vscode.chat.createChatParticipant(
    PARTICIPANT_ID,
    async (request, _chatContext, stream, _token) => {
      const cmd = request.command?.toLowerCase().trim() ?? '';
      const prompt = request.prompt.trim().toLowerCase();
      const intent = cmd || (prompt.split(/\s+/)[0] ?? '');

      outputChannel.appendLine(`[WildwestParticipant] command: "${cmd}" prompt: "${prompt}"`);

      const wwRoot = resolveWildwestDir();
      if (!wwRoot) {
        stream.markdown('No `.wildwest/` directory found in the current workspace. Run **Wild West: Init Town** first.');
        return;
      }

      switch (intent) {
        case 'inbox':
          await handleInbox(wwRoot, stream);
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
  outputChannel.appendLine(`[WildwestParticipant] registered @wildwest chat participant`);
}

// ── Handlers ─────────────────────────────────────────────────────────────────

async function handleInbox(wwRoot: string, stream: vscode.ChatResponseStream): Promise<void> {
  const inboxDir = path.join(wwRoot, 'telegraph', 'inbox');
  if (!fs.existsSync(inboxDir)) {
    stream.markdown('No `telegraph/inbox/` found. Telegraph not initialized.');
    return;
  }
  const memos = fs.readdirSync(inboxDir).filter(
    (f) => f.endsWith('.md') && !f.startsWith('.') && f !== 'history',
  );
  if (memos.length === 0) {
    stream.markdown('**Telegraph inbox is empty.** No unprocessed memos.');
    return;
  }
  stream.markdown(`**Telegraph inbox** — ${memos.length} memo(s):\n\n`);
  for (const memo of memos.sort()) {
    const filePath = path.join(inboxDir, memo);
    const subject = extractSubject(filePath, memo);
    stream.markdown(`- \`${memo}\`  \n  ${subject}\n`);
  }
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
      const state = data.state ?? '?';
      const branch = data.branch ?? file.replace('.json', '');
      const actor = data.actor ?? '';
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
    const lastBeat = fs.existsSync(beatPath)
      ? fs.readFileSync(beatPath, 'utf8').trim()
      : 'unknown';

    stream.markdown(`**Town Status**\n\n`);
    stream.markdown(`| Field | Value |\n|---|---|\n`);
    stream.markdown(`| Alias | \`${registry.alias ?? '—'}\` |\n`);
    stream.markdown(`| Scope | \`${registry.scope ?? '—'}\` |\n`);
    stream.markdown(`| wwuid | \`${registry.wwuid ?? '—'}\` |\n`);
    stream.markdown(`| Last heartbeat | \`${lastBeat}\` |\n`);
  } catch {
    stream.markdown('Failed to read registry.json.');
  }
}

async function handleHelp(stream: vscode.ChatResponseStream): Promise<void> {
  stream.markdown(
    '**@wildwest** — Wild West governance queries\n\n' +
    '| Command | Description |\n|---|---|\n' +
    '| `@wildwest inbox` | List unprocessed telegraph inbox memos |\n' +
    '| `@wildwest board` | List tracked branches from .wildwest/board/ |\n' +
    '| `@wildwest status` | Town identity, registry, and last heartbeat |\n' +
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

function extractSubject(filePath: string, filename: string): string {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    // Try YAML frontmatter subject
    const yamlMatch = content.match(/^---[\s\S]*?^subject:\s*(.+)$/m);
    if (yamlMatch) return yamlMatch[1].trim();
    // Fallback: parse slug from filename
    const parts = filename.replace('.md', '').split('--');
    if (parts.length > 1) return parts[parts.length - 1].replace(/-/g, ' ');
  } catch { /* ignore */ }
  return filename;
}
