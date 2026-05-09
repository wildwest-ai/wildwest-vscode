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
  const turns = Array.isArray(s['turns'])
    ? (s['turns'] as Array<Record<string, unknown>>)
    : [];

  // Derive model from first assistant turn that has meta.model
  const model = turns
    .find(t => t['role'] === 'assistant' && (t['meta'] as Record<string, unknown> | undefined)?.['model'])
    ?.['meta'] as Record<string, unknown> | undefined;
  const modelStr = model?.['model'] as string | undefined;

  const scopeRefs = Array.isArray(s['scope_refs'])
    ? (s['scope_refs'] as Array<Record<string, unknown>>)
    : [];

  const lines: string[] = [
    `# ${toolName} — ${projectName}`,
    '',
    `| | |`,
    `|---|---|`,
    `| **Tool** | ${toolName} (\`${tool}\`) |`,
    ...(modelStr ? [`| **Model** | \`${modelStr}\` |`] : []),
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

  // Collapse consecutive assistant fragments into single blocks (CPT emits many partial turns)
  type Fragment = { kind: 'text' | 'thinking'; text: string };
  type Block = { role: string; fragments: Fragment[]; timestamp: string; model?: string };
  const blocks: Block[] = [];

  for (const t of turns) {
    const role = (t['role'] as string) || '?';
    const rawContent = (t['content'] as string) || '';
    const parts = Array.isArray(t['parts'])
      ? (t['parts'] as Array<Record<string, unknown>>)
      : [];
    const turnModel = (t['meta'] as Record<string, unknown> | undefined)?.['model'] as string | undefined;

    const thinkingText = parts
      .filter(p => p['kind'] === 'thinking')
      .map(p => (p['content'] as string) || '')
      .join('');
    const textFromParts = parts
      .filter(p => p['kind'] === 'text' || p['kind'] === 'None')
      .map(p => (p['content'] as string) || '')
      .join('');
    const text = (rawContent || textFromParts).trimEnd();

    const last = blocks[blocks.length - 1];

    // Thinking turn — attach to current assistant block or start one
    if (thinkingText && !text) {
      if (last && last.role === role) {
        last.fragments.push({ kind: 'thinking', text: thinkingText.trim() });
      } else if (role === 'assistant') {
        blocks.push({ role, fragments: [{ kind: 'thinking', text: thinkingText.trim() }], timestamp: (t['timestamp'] as string) || '', model: turnModel });
      }
      continue;
    }

    // Skip empty turns and lone fence artifacts
    if (!text || text.trim() === '```') continue;

    const ts = (t['timestamp'] as string) || '';

    // Merge consecutive assistant text fragments into the same block
    if (last && last.role === role && role === 'assistant') {
      last.fragments.push({ kind: 'text', text });
      if (!last.model && turnModel) last.model = turnModel;
    } else {
      blocks.push({ role, fragments: [{ kind: 'text', text }], timestamp: ts, model: turnModel });
    }
  }

  for (let i = 0; i < blocks.length; i++) {
    const { role, fragments, timestamp, model: blockModel } = blocks[i];
    const timeStr = timestamp
      ? new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : '';
    const modelLabel = blockModel ? `  ·  \`${blockModel}\`` : '';
    const heading = role === 'user' ? '### User' : `### ${toolName}${modelLabel}`;
    const timeLabel = timeStr ? `  ·  ${timeStr}` : '';

    if (i > 0) lines.push('', '---', '');
    lines.push(`${heading}${timeLabel}`, '');

    for (const frag of fragments) {
      if (frag.kind === 'thinking') {
        const quoted = frag.text.split('\n')
          .map((l, idx) => idx === 0 ? `> 💭 ${l}` : `> ${l}`)
          .join('\n');
        lines.push(quoted, '');
      } else {
        lines.push(frag.text.trimEnd(), '');
      }
    }
  }

  return lines.join('\n');
}
