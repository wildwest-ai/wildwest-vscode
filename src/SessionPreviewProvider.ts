import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export const SESSION_PREVIEW_SCHEME = 'wildwest-session';

const TOOL_NAMES: Record<string, string> = {
  cpt: 'GitHub Copilot',
  cld: 'Claude Code',
  ccx: 'Codex',
};

export class SessionPreviewProvider implements vscode.TextDocumentContentProvider {
  private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this._onDidChange.event;

  provideTextDocumentContent(uri: vscode.Uri): string {
    // URI path: /<wwuid>  query: exportPath=<base64>
    const wwuid = uri.path.replace(/^\//, '');
    const params = new URLSearchParams(uri.query);
    const exportPath = params.get('exportPath') ?? '';

    if (!exportPath) {
      return `# Session not available\n\nNo export path provided.`;
    }

    const jsonPath = path.join(exportPath, 'staged', 'storage', 'sessions', `${wwuid}.json`);

    if (!fs.existsSync(jsonPath)) {
      return `# Session not found\n\nNo file at: \`${jsonPath}\``;
    }

    try {
      const session = JSON.parse(fs.readFileSync(jsonPath, 'utf8')) as Record<string, unknown>;
      return renderSessionMarkdown(session);
    } catch (e) {
      return `# Error reading session\n\n\`\`\`\n${e}\n\`\`\``;
    }
  }

  static uriFor(wwuid: string, exportPath: string): vscode.Uri {
    const query = `exportPath=${encodeURIComponent(exportPath)}`;
    return vscode.Uri.parse(`${SESSION_PREVIEW_SCHEME}:/${wwuid}?${query}`);
  }
}

function fmtTime(iso: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString([], {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function renderSessionMarkdown(s: Record<string, unknown>): string {
  const tool = (s['tool'] as string) || '?';
  const wwuid = (s['wwuid'] as string) || '';
  const projectPath = (s['project_path'] as string) || '';
  const projectName = projectPath ? path.basename(projectPath) : '(unknown)';
  const createdAt = (s['created_at'] as string) || '';
  const lastTurnAt = (s['last_turn_at'] as string) || '';
  const turnCount = (s['turn_count'] as number) ?? 0;
  const toolName = TOOL_NAMES[tool] || tool;
  const scopeRefs = Array.isArray(s['scope_refs'])
    ? (s['scope_refs'] as Array<Record<string, unknown>>)
    : [];
  const turns = Array.isArray(s['turns'])
    ? (s['turns'] as Array<Record<string, unknown>>)
    : [];

  const lines: string[] = [
    `# ${toolName} — ${projectName}`,
    '',
    `| | |`,
    `|---|---|`,
    `| **Tool** | ${toolName} (\`${tool}\`) |`,
    `| **Project** | \`${projectPath || '—'}\` |`,
    `| **Created** | ${fmtTime(createdAt)} |`,
    `| **Last turn** | ${fmtTime(lastTurnAt)} |`,
    `| **Turns** | ${turnCount} |`,
    `| **wwuid** | \`${wwuid}\` |`,
  ];

  if (scopeRefs.length > 0) {
    lines.push('', '**Scopes:**');
    for (const r of scopeRefs) {
      const commits = typeof r['commit_count'] === 'number' ? `  ${r['commit_count']} commits` : '';
      lines.push(`- \`${r['scope']}\` · **${r['alias']}**${commits}`);
    }
  }

  lines.push('', '---', '', '## Conversation', '');

  for (let i = 0; i < turns.length; i++) {
    const t = turns[i];
    const role = (t['role'] as string) || '?';
    const content = ((t['content'] as string) || '').trimEnd();
    const ts = (t['timestamp'] as string) || '';
    const timeStr = ts
      ? new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : '';
    const heading = role === 'user' ? '### Human' : '### Assistant';
    const timeLabel = timeStr ? `  ·  ${timeStr}` : '';

    if (i > 0) lines.push('', '---', '');
    lines.push(`${heading}${timeLabel}`, '', content);
  }

  return lines.join('\n');
}
