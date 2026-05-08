import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { HeartbeatMonitor } from './HeartbeatMonitor';
import { getTelegraphDirs } from './TelegraphService';

// ── SidePanelItem ────────────────────────────────────────────────────────────

export class SidePanelItem extends vscode.TreeItem {
  constructor(
    label: string,
    collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly sectionId?: string,
    resourceUri?: vscode.Uri,
  ) {
    super(label, collapsibleState);
    if (resourceUri) {
      this.resourceUri = resourceUri;
      this.command = { command: 'vscode.open', title: 'Open', arguments: [resourceUri] };
      this.tooltip = label;
    }
  }
}

// ── SidePanelProvider ────────────────────────────────────────────────────────

const REFRESH_INTERVAL_MS = 10_000;

export class SidePanelProvider
  implements vscode.TreeDataProvider<SidePanelItem>, vscode.Disposable
{
  private readonly _onDidChangeTreeData =
    new vscode.EventEmitter<SidePanelItem | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private refreshInterval: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly heartbeatMonitor: HeartbeatMonitor) {
    this.refreshInterval = setInterval(() => this.refresh(), REFRESH_INTERVAL_MS);
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  dispose(): void {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
    this._onDidChangeTreeData.dispose();
  }

  getTreeItem(element: SidePanelItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: SidePanelItem): SidePanelItem[] {
    if (!element) {
      return this.getRootSections();
    }
    if (element.sectionId) {
      return this.getSectionChildren(element.sectionId);
    }
    return [];
  }

  // ── Root sections ─────────────────────────────────────────────────────────

  private getRootSections(): SidePanelItem[] {
    const inboxFiles = this.collectTelegraphFiles('inbox');
    const outboxFiles = this.collectTelegraphFiles('outbox');
    const historyFiles = this.collectTelegraphFiles('history');
    const boardFiles = this.collectBoardFiles();
    return [
      this.sectionItem('Inbox', 'inbox', inboxFiles.length),
      this.sectionItem('Outbox', 'outbox', outboxFiles.length),
      this.sectionItem('History', 'history', historyFiles.length),
      this.sectionItem('Board', 'board', boardFiles.length),
      new SidePanelItem('Heartbeat', vscode.TreeItemCollapsibleState.Collapsed, 'heartbeat'),
      new SidePanelItem('Actor', vscode.TreeItemCollapsibleState.Collapsed, 'actor'),
    ];
  }

  private sectionItem(label: string, sectionId: string, count: number): SidePanelItem {
    const displayLabel = count > 0 ? `${label} (${count})` : label;
    return new SidePanelItem(displayLabel, vscode.TreeItemCollapsibleState.Collapsed, sectionId);
  }

  private getSectionChildren(sectionId: string): SidePanelItem[] {
    switch (sectionId) {
      case 'inbox':     return this.memoItems(this.collectTelegraphFiles('inbox'));
      case 'outbox':    return this.memoItems(this.collectTelegraphFiles('outbox'));
      case 'history':   return this.memoItems(this.collectTelegraphFiles('history'));
      case 'board':     return this.boardChildren();
      case 'heartbeat': return this.heartbeatChildren();
      case 'actor':     return this.actorChildren();
      default:          return [];
    }
  }

  // ── Telegraph (inbox / outbox / history) ──────────────────────────────────

  private collectTelegraphFiles(
    section: 'inbox' | 'outbox' | 'history',
  ): Array<{ dir: string; file: string }> {
    const results: Array<{ dir: string; file: string }> = [];
    for (const telegraphDir of getTelegraphDirs()) {
      const targetDir =
        section === 'history'
          ? path.join(telegraphDir, 'inbox', 'history')
          : path.join(telegraphDir, section);
      for (const file of this.listMdFiles(targetDir)) {
        results.push({ dir: targetDir, file });
      }
    }
    return results;
  }

  private memoItems(files: Array<{ dir: string; file: string }>): SidePanelItem[] {
    if (files.length === 0) {
      return [new SidePanelItem('(empty)', vscode.TreeItemCollapsibleState.None)];
    }
    return files.map(({ dir, file }) => {
      const uri = vscode.Uri.file(path.join(dir, file));
      return new SidePanelItem(file, vscode.TreeItemCollapsibleState.None, undefined, uri);
    });
  }

  // ── Board ─────────────────────────────────────────────────────────────────

  private collectBoardFiles(): Array<{ dir: string; file: string }> {
    const wwRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!wwRoot) return [];
    const boardDir = path.join(wwRoot, '.wildwest', 'board', 'branches');
    return this.listMdFiles(boardDir).map((file) => ({ dir: boardDir, file }));
  }

  private boardChildren(): SidePanelItem[] {
    const files = this.collectBoardFiles();
    if (files.length === 0) {
      return [new SidePanelItem('(no branches)', vscode.TreeItemCollapsibleState.None)];
    }
    return files.map(({ dir, file }) => {
      const uri = vscode.Uri.file(path.join(dir, file));
      return new SidePanelItem(file, vscode.TreeItemCollapsibleState.None, undefined, uri);
    });
  }

  // ── Heartbeat ─────────────────────────────────────────────────────────────

  private heartbeatChildren(): SidePanelItem[] {
    const state = this.heartbeatMonitor.checkLiveness();
    const scope = this.heartbeatMonitor.detectScope() ?? '—';
    const lastBeat = this.readSentinelTimestamp();
    const stateIcon = state === 'alive' ? '●' : state === 'flagged' ? '⚑' : '○';
    return [
      new SidePanelItem(`State: ${stateIcon} ${state}`, vscode.TreeItemCollapsibleState.None),
      new SidePanelItem(`Scope: ${scope}`, vscode.TreeItemCollapsibleState.None),
      new SidePanelItem(`Last beat: ${lastBeat}`, vscode.TreeItemCollapsibleState.None),
    ];
  }

  private readSentinelTimestamp(): string {
    const wwRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!wwRoot) return '—';
    const sentinelFile = path.join(wwRoot, '.wildwest', 'telegraph', '.last-beat');
    try {
      return fs.readFileSync(sentinelFile, 'utf8').trim() || '—';
    } catch {
      return '—';
    }
  }

  // ── Actor ─────────────────────────────────────────────────────────────────

  private actorChildren(): SidePanelItem[] {
    const wwRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    let alias = '—';
    if (wwRoot) {
      try {
        const reg = JSON.parse(
          fs.readFileSync(path.join(wwRoot, '.wildwest', 'registry.json'), 'utf8'),
        ) as Record<string, unknown>;
        alias = (reg['alias'] as string) ?? '—';
      } catch {
        // registry missing or unreadable
      }
    }
    const role =
      vscode.workspace.getConfiguration('wildwest').get<string>('actor', '') || '—';
    return [
      new SidePanelItem(`Alias: ${alias}`, vscode.TreeItemCollapsibleState.None),
      new SidePanelItem(`Role: ${role}`, vscode.TreeItemCollapsibleState.None),
    ];
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private listMdFiles(dir: string): string[] {
    try {
      return fs
        .readdirSync(dir)
        .filter((f) => f.endsWith('.md') && !f.startsWith('.') && f !== '.gitkeep')
        .sort();
    } catch {
      return [];
    }
  }
}
