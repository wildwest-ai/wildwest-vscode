import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { PromptIndexService, PromptKind } from './PromptIndexService';

/**
 * VSCode completion provider that surfaces past prompts as IntelliSense suggestions.
 *
 * Activates in markdown files (memos, CLAUDE.md) when the user has typed at least
 * 3 characters on a line. Filters by the active workspace's scope_alias when available.
 */
export class PromptCompletionProvider implements vscode.CompletionItemProvider {
  constructor(private readonly promptIndex: PromptIndexService) {}

  provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.CompletionItem[] {
    const lineText = document.lineAt(position).text;
    const query = lineText.substring(0, position.character).trim();

    if (query.length < 3) return [];

    const scopeAliases = this.getScopeAliases(document);
    const excludedKinds: PromptKind[] = ['terminal_output', 'authorization', 'continuation'];
    const results = this.promptIndex.search(query, scopeAliases, 15, {
      excludeKinds: excludedKinds,
      includeGlobalFallback: false,
      includeScopeLineage: true,
    });

    return results.map((p, i) => {
      const label = p.content.length > 72 ? p.content.slice(0, 72) + '…' : p.content;
      const item = new vscode.CompletionItem(label, vscode.CompletionItemKind.Text);
      const freqTag = p.frequency > 1 ? ` ×${p.frequency}` : '';
      const compliance = p.framework_compliant ? 'framework-ok' : `flags:${p.compliance_flags.length}`;
      item.detail = `score ${p.score.toFixed(2)}${freqTag} · ${p.kind} · ${compliance} · ${p.scope_alias || p.recorder_scope} · ${p.last_used.slice(0, 10)}`;
      item.documentation = new vscode.MarkdownString(
        `**Score:** ${p.score.toFixed(3)}  \n` +
        `**Kind:** ${p.kind}  \n` +
        `**Framework:** ${p.framework_compliant ? 'compliant' : p.compliance_flags.join(', ')}  \n` +
        `**Used:** ${p.frequency}×  (${p.first_used.slice(0, 10)} – ${p.last_used.slice(0, 10)})  \n` +
        `**Chars:** ${p.char_count}\n\n` +
        '```\n' + p.content + '\n```'
      );
      item.insertText = p.content;
      item.sortText = String(i).padStart(4, '0');
      item.filterText = p.content;
      return item;
    });
  }

  private getScopeAliases(document: vscode.TextDocument): string[] {
    const folder =
      vscode.workspace.getWorkspaceFolder(document.uri) ??
      vscode.workspace.workspaceFolders?.[0];
    if (!folder) return [];

    const aliases: string[] = [];
    let current = folder.uri.fsPath;
    for (let depth = 0; depth < 4; depth++) {
      const registryPath = path.join(current, '.wildwest', 'registry.json');
      if (fs.existsSync(registryPath)) {
        try {
          const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8')) as Record<string, unknown>;
          const alias = typeof registry['alias'] === 'string' ? registry['alias'] : '';
          if (alias) aliases.push(alias);
        } catch { /* ignore malformed local registry */ }
      }

      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }

    aliases.push(folder.name);
    return Array.from(new Set(aliases.filter(Boolean)));
  }
}
