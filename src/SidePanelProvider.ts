import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { HeartbeatMonitor } from './HeartbeatMonitor';
import { getTelegraphDirs } from './TelegraphService';
import { DeliveryReceipt, getDeliveryReceipts, statusIcon } from './DeliveryReceipts';

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

  private isWatching: boolean = false;
  private exportPath: string = '';

  constructor(private readonly heartbeatMonitor: HeartbeatMonitor) {
    this.refreshInterval = setInterval(() => this.refresh(), REFRESH_INTERVAL_MS);
  }

  /** Called by SessionExporter (via extension.ts) when the watcher starts or stops. */
  setWatching(value: boolean): void {
    this.isWatching = value;
    this.refresh();
  }

  /** Called by extension.ts to provide the export path for Sessions section. */
  setExportPath(p: string): void {
    this.exportPath = p;
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
    const receipts = this.collectAllReceipts();
    const sessionCounts = this.countStagedSessions();
    const sessionTotal = sessionCounts.today + sessionCounts.yesterday + sessionCounts.last7d + sessionCounts.older;
    return [
      new SidePanelItem('Heartbeat', vscode.TreeItemCollapsibleState.Collapsed, 'heartbeat'),
      new SidePanelItem('Identity', vscode.TreeItemCollapsibleState.Collapsed, 'identity'),
      this.sectionItem('Sessions', 'sessions', sessionTotal),
      new SidePanelItem('Utilities', vscode.TreeItemCollapsibleState.Collapsed, 'utilities'),
      this.sectionItem('Inbox', 'inbox', inboxFiles.length),
      this.sectionItem('Outbox', 'outbox', outboxFiles.length),
      this.sectionItem('History', 'history', historyFiles.length),
      this.sectionItem('Board', 'board', boardFiles.length),
      this.sectionItem('Receipts', 'receipts', receipts.length),
    ];
  }

  private sectionItem(label: string, sectionId: string, count: number): SidePanelItem {
    const displayLabel = count > 0 ? `${label} (${count})` : label;
    return new SidePanelItem(displayLabel, vscode.TreeItemCollapsibleState.Collapsed, sectionId);
  }

  private getSectionChildren(sectionId: string): SidePanelItem[] {
    switch (sectionId) {
      case 'heartbeat': return this.heartbeatChildren();
      case 'identity':  return this.identityChildren();
      case 'sessions':  return this.sessionsChildren();
      case 'utilities': return this.utilitiesChildren();
      case 'inbox':     return this.memoItems(this.collectTelegraphFiles('inbox'));
      case 'outbox':    return this.memoItems(this.collectTelegraphFiles('outbox'));
      case 'history':   return this.memoItems(this.collectTelegraphFiles('history'));
      case 'board':     return this.boardChildren();
      case 'receipts':  return this.receiptsChildren();
      default:          return [];
    }
  }

  // ── Sessions ───────────────────────────────────────────────────────────────

  private countStagedSessions(): { today: number; yesterday: number; last7d: number; older: number } {
    const counts = { today: 0, yesterday: 0, last7d: 0, older: 0 };
    if (!this.exportPath) return counts;
    const stagedDir = path.join(this.exportPath, 'staged');
    try {
      const files = fs.readdirSync(stagedDir).filter((f) => f.endsWith('.json') && !f.startsWith('.'));
      const now = Date.now();
      const dayMs = 86_400_000;
      const todayStart = new Date(); todayStart.setHours(0,0,0,0);
      const todayMs = todayStart.getTime();
      for (const f of files) {
        try {
          const mtime = fs.statSync(path.join(stagedDir, f)).mtimeMs;
          const age = now - mtime;
          if (mtime >= todayMs) counts.today++;
          else if (age < 2 * dayMs) counts.yesterday++;
          else if (age < 7 * dayMs) counts.last7d++;
          else counts.older++;
        } catch { /* skip */ }
      }
    } catch { /* staged dir not ready */ }
    return counts;
  }

  private sessionsChildren(): SidePanelItem[] {
    const watcherLabel = this.isWatching ? '● Watcher: Running' : '○ Watcher: Stopped';
    const watcherCmd = this.isWatching ? 'wildwest.stopWatcher' : 'wildwest.startWatcher';
    const watcherItem = new SidePanelItem(watcherLabel, vscode.TreeItemCollapsibleState.None);
    watcherItem.iconPath = new vscode.ThemeIcon(this.isWatching ? 'eye' : 'eye-closed');
    watcherItem.command = { command: watcherCmd, title: this.isWatching ? 'Stop Watcher' : 'Start Watcher' };

    const counts = this.countStagedSessions();
    const bucket = (label: string, count: number): SidePanelItem => {
      const item = new SidePanelItem(`${label}   ${count}`, vscode.TreeItemCollapsibleState.None);
      item.iconPath = new vscode.ThemeIcon('history');
      return item;
    };

    return [
      watcherItem,
      bucket('Today', counts.today),
      bucket('Yesterday', counts.yesterday),
      bucket('Last 7 days', counts.last7d),
      bucket('Older', counts.older),
    ];
  }

  // ── Utilities ─────────────────────────────────────────────────────────────

  private utilitiesChildren(): SidePanelItem[] {
    const action = (label: string, cmd: string, icon: string): SidePanelItem => {
      const item = new SidePanelItem(label, vscode.TreeItemCollapsibleState.None);
      item.iconPath = new vscode.ThemeIcon(icon);
      item.command = { command: cmd, title: label };
      return item;
    };
    return [
      action('Export Now', 'wildwest.exportNow', 'sync'),
      action('Open Export Folder', 'wildwest.openExportFolder', 'folder-opened'),
      action('Doctor', 'wildwest.doctor', 'heart'),
      action('Validate Registry', 'wildwest.validateRegistry', 'shield'),
      action('Reset Session Consent', 'wildwest.resetSessionConsent', 'refresh'),
      action('View Output Log', 'wildwest.viewOutputLog', 'output'),
      action('Settings', 'wildwest.openSettings', 'gear'),
    ];
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

  // ── Receipts ──────────────────────────────────────────────────────────────

  private collectAllReceipts(): DeliveryReceipt[] {
    const all: DeliveryReceipt[] = [];
    for (const telegraphDir of getTelegraphDirs()) {
      all.push(...getDeliveryReceipts(telegraphDir));
    }
    return all;
  }

  private receiptsChildren(): SidePanelItem[] {
    const receipts = this.collectAllReceipts();
    if (receipts.length === 0) {
      return [new SidePanelItem('(no sent memos)', vscode.TreeItemCollapsibleState.None)];
    }
    return receipts.map((r) => {
      const label = `${statusIcon(r.status)} ${r.subject}`;
      const uri = vscode.Uri.file(r.filePath);
      return new SidePanelItem(label, vscode.TreeItemCollapsibleState.None, undefined, uri);
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

    // Read town alias from registry
    const wwRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    let townAlias = '—';
    if (wwRoot) {
      try {
        const reg = JSON.parse(
          fs.readFileSync(path.join(wwRoot, '.wildwest', 'registry.json'), 'utf8'),
        ) as Record<string, unknown>;
        townAlias = (reg['alias'] as string) ?? '—';
      } catch { /* registry unreadable */ }
    }

    return [
      new SidePanelItem(`${stateIcon} ${state}`, vscode.TreeItemCollapsibleState.None),
      new SidePanelItem(`Scope: ${scope}`, vscode.TreeItemCollapsibleState.None),
      new SidePanelItem(`Town: ${townAlias}`, vscode.TreeItemCollapsibleState.None),
      new SidePanelItem(`Last beat: ${lastBeat}`, vscode.TreeItemCollapsibleState.None),
    ];
  }

  private readSentinelTimestamp(): string {
    const wwRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!wwRoot) return '—';
    const scope = this.heartbeatMonitor.detectScope();
    // Town sentinel: .wildwest/telegraph/.last-beat
    // County/territory sentinel: .wildwest/.last-beat
    const sentinelFile = scope === 'town'
      ? path.join(wwRoot, '.wildwest', 'telegraph', '.last-beat')
      : path.join(wwRoot, '.wildwest', '.last-beat');
    try {
      return fs.readFileSync(sentinelFile, 'utf8').trim() || '—';
    } catch {
      return '—';
    }
  }

  // ── Actor ─────────────────────────────────────────────────────────────────

  private identityChildren(): SidePanelItem[] {
    const identitySetting = vscode.workspace.getConfiguration('wildwest').get<string>('identity', '') || '';

    // Parse "TM(RHk)" → role="TM", dyad="RHk"
    let role = identitySetting || '—';
    let dyad = '—';
    const match = identitySetting.match(/^([^(]+)\(([^)]+)\)$/);
    if (match) {
      role = match[1].trim();
      dyad = match[2].trim();
    }

    const editItem = new SidePanelItem('Edit identity…', vscode.TreeItemCollapsibleState.None);
    editItem.iconPath = new vscode.ThemeIcon('edit');
    editItem.command = { command: 'wildwest.setIdentity', title: 'Set Identity' };

    return [
      new SidePanelItem(`Role: ${role}`, vscode.TreeItemCollapsibleState.None),
      new SidePanelItem(`dyad: ${dyad}`, vscode.TreeItemCollapsibleState.None),
      editItem,
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
