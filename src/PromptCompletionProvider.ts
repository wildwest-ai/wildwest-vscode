import * as vscode from 'vscode';
import { PromptIndexService } from './PromptIndexService';

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

    // Derive scope alias from the active workspace folder name (best-effort)
    const workspaceName = vscode.workspace.workspaceFolders?.[0]?.name;
    const scopeAlias = workspaceName ?? undefined;

    // First try scope-filtered search; fall back to unfiltered if no results
    let results = this.promptIndex.search(query, scopeAlias, 15);
    if (results.length === 0 && scopeAlias) {
      results = this.promptIndex.search(query, undefined, 15);
    }

    return results.map((p, i) => {
      const label = p.content.length > 72 ? p.content.slice(0, 72) + '…' : p.content;
      const item = new vscode.CompletionItem(label, vscode.CompletionItemKind.Text);
      item.detail = `${p.tool} · ${p.scope_alias || p.recorder_scope} · ${p.timestamp.slice(0, 10)}`;
      item.documentation = new vscode.MarkdownString(
        `**Session:** \`${p.session_wwuid.slice(0, 8)}…\`  \n` +
        `**Turn:** ${p.turn_index}  \n` +
        `**Chars:** ${p.char_count}\n\n` +
        '```\n' + p.content + '\n```'
      );
      item.insertText = p.content;
      // Sort newest-first — use zero-padded index so VSCode preserves order
      item.sortText = String(i).padStart(4, '0');
      item.filterText = p.content;
      return item;
    });
  }
}
