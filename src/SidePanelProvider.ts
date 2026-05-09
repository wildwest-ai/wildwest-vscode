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
  private sessionSortBy: 'created' | 'updated' = 'created';

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

  /** Toggle session date grouping between created and updated. */
  toggleSessionSortBy(): void {
    this.sessionSortBy = this.sessionSortBy === 'created' ? 'updated' : 'created';
    this.refresh();
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
    const sessionCounts = this.countStagedSessions(this.sessionSortBy);
    const sessionTotal = sessionCounts.today + sessionCounts.yesterday + sessionCounts.last7d + sessionCounts.older;

    // ── Heartbeat inline ────────────────────────────────────────────────────
    const hbState = this.heartbeatMonitor.checkLiveness();
    const hbIcon = hbState === 'alive' ? '●' : hbState === 'flagged' ? '⚑' : '○';
    const lastBeat = this.readSentinelTimestamp();
    const lastBeatAgo = this.timeAgo(lastBeat);
    const hbItem = new SidePanelItem(`${hbIcon} ${hbState}  ${lastBeatAgo}`, vscode.TreeItemCollapsibleState.None);
    hbItem.iconPath = new vscode.ThemeIcon(hbState === 'alive' ? 'pulse' : 'warning');

    if (hbState === 'flagged') {
      const wwRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      const inboxDir = wwRoot ? path.join(wwRoot, '.wildwest', 'telegraph', 'inbox') : null;
      let memos: string[] = [];
      try {
        if (inboxDir && fs.existsSync(inboxDir)) {
          memos = fs.readdirSync(inboxDir).filter(f => f.endsWith('.md') && !f.startsWith('.') && f !== '.gitkeep');
        }
      } catch { /* ignore */ }
      const tip = new vscode.MarkdownString(`**⚑ Flagged** — Last beat: ${lastBeat}\n\n`);
      if (memos.length > 0) {
        tip.appendMarkdown(`**Unprocessed inbox (${memos.length}):**\n\n`);
        for (const memo of memos.slice(0, 5)) {
          const subject = memo.replace(/^\d{8}-\d{4}Z?-/, '').replace(/\.md$/, '');
          tip.appendMarkdown(`- ${subject}\n`);
        }
        if (memos.length > 5) tip.appendMarkdown(`- …and ${memos.length - 5} more\n`);
      }
      hbItem.tooltip = tip;
    } else {
      hbItem.tooltip = `Heartbeat: ${hbState}\nLast beat: ${lastBeat}`;
    }

    // ── Scope inline ────────────────────────────────────────────────────────
    const { scope, label: scopeLabel } = this.readRegistryScope();
    const SCOPE_ICONS: Record<string, string> = { town: 'home', county: 'organization', territory: 'globe' };
    const scopeItem = new SidePanelItem(`${scope}  [${scopeLabel}]`, vscode.TreeItemCollapsibleState.None);
    scopeItem.iconPath = new vscode.ThemeIcon(SCOPE_ICONS[scope] ?? 'globe');
    scopeItem.tooltip = 'Scope filter set by .wildwest/registry.json';

    // ── Identity inline ─────────────────────────────────────────────────────
    const identitySetting = vscode.workspace.getConfiguration('wildwest').get<string>('identity', '') || '';
    const idMatch = identitySetting.match(/^([^(]+)\(([^)]+)\)$/);
    const idLabel = idMatch ? `${idMatch[1].trim()}  (${idMatch[2].trim()})` : (identitySetting || 'Identity not set');
    const idItem = new SidePanelItem(idLabel, vscode.TreeItemCollapsibleState.None);
    idItem.iconPath = new vscode.ThemeIcon('person');
    idItem.contextValue = 'identity';
    idItem.tooltip = 'Click to edit identity';
    idItem.command = { command: 'wildwest.setIdentity', title: 'Set Identity' };

    return [
      scopeItem,
      idItem,
      this.sectionItem('Sessions', 'sessions', sessionTotal),
      new SidePanelItem('Utilities', vscode.TreeItemCollapsibleState.Collapsed, 'utilities'),
      this.sectionItem('Inbox', 'inbox', inboxFiles.length),
      this.sectionItem('Outbox', 'outbox', outboxFiles.length),
      this.sectionItem('History', 'history', historyFiles.length),
      this.sectionItem('Board', 'board', boardFiles.length),
      this.sectionItem('Receipts', 'receipts', receipts.length),
      hbItem,
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
      case 'receipts':       return this.receiptsChildren();
      case 'sessions:recent':  return this.sessionRecentChildren();
      case 'sessions:today':    return this.sessionBucketChildren('today');
      case 'sessions:yesterday': return this.sessionBucketChildren('yesterday');
      case 'sessions:last7d':   return this.sessionLast7dChildren();
      case 'sessions:older':    return this.sessionOlderChildren();
      default:
        if (sectionId.startsWith('sessions:last7d:')) {
          return this.sessionDateChildren(sectionId.slice('sessions:last7d:'.length));
        }
        if (sectionId.startsWith('sessions:older:')) {
          return this.sessionOlderMonthChildren(sectionId.slice('sessions:older:'.length));
        }
        return [];
    }
  }

  // ── Sessions ───────────────────────────────────────────────────────────────

  /**
   * Read scope + alias from workspace registry and resolve the path filter.
   * Returns { scope, label, filterPath, alias } where filterPath is the prefix to match
   * against session.project_path (for county), alias is the town/county name.
   */
  private readRegistryScope(): { scope: string; label: string; filterPath: string | null; alias: string } {
    const townRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
    const fallback = { scope: 'territory', label: 'Territory', filterPath: null, alias: '' };
    if (!townRoot) return fallback;
    try {
      const regPath = path.join(townRoot, '.wildwest', 'registry.json');
      if (!fs.existsSync(regPath)) return fallback;
      const reg = JSON.parse(fs.readFileSync(regPath, 'utf8')) as Record<string, unknown>;
      const scope = (reg['scope'] as string) || 'territory';
      const alias = (reg['alias'] as string) || path.basename(townRoot);
      if (scope === 'town') {
        return { scope, label: alias, filterPath: townRoot, alias };
      }
      if (scope === 'county') {
        return { scope, label: alias, filterPath: townRoot, alias };
      }
      return { scope: 'territory', label: alias, filterPath: null, alias };
    } catch {
      return fallback;
    }
  }

  /**
   * Walk parent dirs from townRoot to find the county root
   * (nearest ancestor with scope === 'county' in its registry).
   */
  private findCountyRoot(townRoot: string): string | null {
    let current = path.dirname(townRoot);
    const fsRoot = path.parse(current).root;
    while (current !== fsRoot) {
      try {
        const regPath = path.join(current, '.wildwest', 'registry.json');
        if (fs.existsSync(regPath)) {
          const reg = JSON.parse(fs.readFileSync(regPath, 'utf8')) as Record<string, unknown>;
          if (reg['scope'] === 'county') return current;
        }
      } catch { /* skip */ }
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
    return null;
  }

  private loadAndBucketSessions(sortBy: 'created' | 'updated'): {
    today: Record<string, unknown>[];
    yesterday: Record<string, unknown>[];
    last7d: Record<string, unknown>[];
    older: Record<string, unknown>[];
    byTool: Record<string, number>;
  } {
    type S = Record<string, unknown>;
    const empty = { today: [] as S[], yesterday: [] as S[], last7d: [] as S[], older: [] as S[], byTool: {} as Record<string, number> };
    if (!this.exportPath) return empty;
    const indexPath = path.join(this.exportPath, 'staged', 'storage', 'index.json');
    try {
      if (!fs.existsSync(indexPath)) return empty;
      const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));

      // ── Scope filter ──────────────────────────────────────────────────────
      const townRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
      const { scope, filterPath } = this.readRegistryScope();
      const countyRoot: string | null = scope === 'county' ? this.findCountyRoot(townRoot) : null;
      const scopeFilter = (session: S): boolean => {
        const pp = (session['project_path'] as string) || '';
        if (scope === 'town') {
          return pp === townRoot;
        }
        if (scope === 'county') {
          const root = filterPath ?? countyRoot;
          return root !== null && (pp === root || pp.startsWith(root + path.sep));
        }
        return true; // territory
      };
      const dayMs = 86_400_000;
      const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
      const todayMs = todayStart.getTime();
      const yesterdayMs = todayMs - dayMs;
      const last7dMs = todayMs - 7 * dayMs;
      const result = { today: [] as S[], yesterday: [] as S[], last7d: [] as S[], older: [] as S[], byTool: {} as Record<string, number> };
      for (const session of (index.sessions ?? [])) {
        try {
          if (!scopeFilter(session)) continue;
          const ts = sortBy === 'updated'
            ? (session.last_turn_at ?? session.created_at)
            : (session.created_at ?? session.last_turn_at);
          const mtime = new Date(ts).getTime();
          if (mtime >= todayMs) result.today.push(session);
          else if (mtime >= yesterdayMs) result.yesterday.push(session);
          else if (mtime >= last7dMs) result.last7d.push(session);
          else result.older.push(session);
          const tool = (session.tool as string) || 'unknown';
          result.byTool[tool] = (result.byTool[tool] ?? 0) + 1;
        } catch { /* skip */ }
      }
      const byTs = (a: S, b: S) => {
        const ta = sortBy === 'updated' ? (a['last_turn_at'] ?? a['created_at']) : (a['created_at'] ?? a['last_turn_at']);
        const tb = sortBy === 'updated' ? (b['last_turn_at'] ?? b['created_at']) : (b['created_at'] ?? b['last_turn_at']);
        return new Date(tb as string).getTime() - new Date(ta as string).getTime();
      };
      result.today.sort(byTs);
      result.yesterday.sort(byTs);
      result.last7d.sort(byTs);
      result.older.sort(byTs);
      return result;
    } catch { return empty; }
  }

  private countStagedSessions(sortBy: 'created' | 'updated'): {
    today: number; yesterday: number; last7d: number; older: number;
    todayTurns: number; yesterdayTurns: number; last7dTurns: number; olderTurns: number;
    byTool: Record<string, number>;
  } {
    const data = this.loadAndBucketSessions(sortBy);
    const turns = (arr: Record<string, unknown>[]) => arr.reduce((s, x) => s + ((x['turn_count'] as number) || 0), 0);
    return {
      today: data.today.length,
      yesterday: data.yesterday.length,
      last7d: data.last7d.length,
      older: data.older.length,
      todayTurns: turns(data.today),
      yesterdayTurns: turns(data.yesterday),
      last7dTurns: turns(data.last7d),
      olderTurns: turns(data.older),
      byTool: data.byTool,
    };
  }

  private sessionsChildren(): SidePanelItem[] {
    const watcherLabel = this.isWatching ? '● Watcher: Running' : '○ Watcher: Stopped';
    const watcherCmd = this.isWatching ? 'wildwest.stopWatcher' : 'wildwest.startWatcher';
    const watcherItem = new SidePanelItem(watcherLabel, vscode.TreeItemCollapsibleState.None);
    watcherItem.iconPath = new vscode.ThemeIcon(this.isWatching ? 'eye' : 'eye-closed');
    watcherItem.command = { command: watcherCmd, title: this.isWatching ? 'Stop Watcher' : 'Start Watcher' };

    const sortLabel = this.sessionSortBy === 'created' ? 'Sort: Created' : 'Sort: Updated';
    const sortItem = new SidePanelItem(sortLabel, vscode.TreeItemCollapsibleState.None);
    sortItem.iconPath = new vscode.ThemeIcon('sort-precedence');
    sortItem.tooltip = 'Click to toggle between Created and Updated date';
    sortItem.command = { command: 'wildwest.toggleSessionSortBy', title: 'Toggle Session Sort' };

    const counts = this.countStagedSessions(this.sessionSortBy);

    const makeBucket = (lbl: string, sectionId: string, count: number, turns: number): SidePanelItem => {
      const state = count > 0
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None;
      const item = new SidePanelItem(`${lbl}   ${count} (${turns})`, state, sectionId);
      item.iconPath = new vscode.ThemeIcon('history');
      return item;
    };
    const toolBadge = (lbl: string, count: number): SidePanelItem => {
      const item = new SidePanelItem(`${lbl}   ${count}`, vscode.TreeItemCollapsibleState.None);
      item.iconPath = new vscode.ThemeIcon('robot');
      return item;
    };

    const TOOL_LABELS: Record<string, string> = {
      cpt: 'Copilot',
      cld: 'Claude',
      ccx: 'Codex',
    };
    const toolRows = Object.entries(counts.byTool)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([tool, count]) => toolBadge(`  ${TOOL_LABELS[tool] ?? tool}`, count));

    const recentTotal = counts.today + counts.yesterday + counts.last7d;
    const allTotal = recentTotal + counts.older;
    const recentItem = new SidePanelItem(`Recent   ${recentTotal}  /  All   ${allTotal}`, vscode.TreeItemCollapsibleState.Collapsed, 'sessions:recent');
    recentItem.iconPath = new vscode.ThemeIcon('pulse');
    recentItem.tooltip = `Recent (last 8 days): Today (${counts.today}) + Yesterday (${counts.yesterday}) + Last 7 days (${counts.last7d})\nAll time: ${allTotal}`;

    return [
      watcherItem,
      sortItem,
      recentItem,
      makeBucket('Older', 'sessions:older', counts.older, counts.olderTurns),
      ...toolRows,
    ];
  }

  /** Local-timezone YYYY-MM-DD for a timestamp string. */
  private localDateStr(ts: string): string {
    const d = new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  private sessionRecentChildren(): SidePanelItem[] {
    const counts = this.countStagedSessions(this.sessionSortBy);
    const makeBucket = (lbl: string, sectionId: string, count: number, turns: number): SidePanelItem => {
      const state = count > 0
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None;
      const item = new SidePanelItem(`${lbl}   ${count} (${turns})`, state, sectionId);
      item.iconPath = new vscode.ThemeIcon('history');
      return item;
    };
    const TOOL_LABELS: Record<string, string> = { cpt: 'Copilot', cld: 'Claude', ccx: 'Codex' };
    const TOOL_ICONS: Record<string, string> = { cpt: 'github', cld: 'comment-discussion', ccx: 'circuit-board' };
    const recentByTool = this.countRecentByTool();
    const toolRows = Object.entries(recentByTool)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([tool, count]) => {
        const item = new SidePanelItem(`  ${TOOL_LABELS[tool] ?? tool}   ${count}`, vscode.TreeItemCollapsibleState.None);
        item.iconPath = new vscode.ThemeIcon(TOOL_ICONS[tool] ?? 'robot');
        return item;
      });
    return [
      makeBucket('Today', 'sessions:today', counts.today, counts.todayTurns),
      makeBucket('Yesterday', 'sessions:yesterday', counts.yesterday, counts.yesterdayTurns),
      makeBucket('Last 7 days', 'sessions:last7d', counts.last7d, counts.last7dTurns),
      ...toolRows,
    ];
  }

  private countRecentByTool(): Record<string, number> {
    if (!this.exportPath) return {};
    const indexPath = path.join(this.exportPath, 'staged', 'storage', 'index.json');
    try {
      if (!fs.existsSync(indexPath)) return {};
      const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
      const townRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
      const { scope, filterPath } = this.readRegistryScope();
      const scopeFilter = (session: Record<string, unknown>): boolean => {
        const pp = (session['project_path'] as string) || '';
        if (scope === 'town') {
          return pp === townRoot;
        }
        if (scope === 'county') {
          return filterPath !== null && (pp === filterPath || pp.startsWith(filterPath + path.sep));
        }
        return true;
      };
      const dayMs = 86_400_000;
      const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
      const last7dMs = todayStart.getTime() - 7 * dayMs;
      const result: Record<string, number> = {};
      for (const session of (index.sessions ?? [])) {
        if (!scopeFilter(session)) continue;
        const ts = this.sessionSortBy === 'updated'
          ? (session.last_turn_at ?? session.created_at)
          : (session.created_at ?? session.last_turn_at);
        if (!ts || new Date(ts).getTime() < last7dMs) continue;
        const tool = (session.tool as string) || 'unknown';
        result[tool] = (result[tool] ?? 0) + 1;
      }
      return result;
    } catch { return {}; }
  }

  private sessionBucketChildren(bucket: 'today' | 'yesterday'): SidePanelItem[] {
    const data = this.loadAndBucketSessions(this.sessionSortBy);
    const sessions = data[bucket];
    if (sessions.length === 0) {
      return [new SidePanelItem('(none)', vscode.TreeItemCollapsibleState.None)];
    }
    return sessions.map((s) => this.sessionRow(s));
  }

  private sessionOlderChildren(): SidePanelItem[] {
    const data = this.loadAndBucketSessions(this.sessionSortBy);
    const sessions = data.older;
    if (sessions.length === 0) {
      return [new SidePanelItem('(none)', vscode.TreeItemCollapsibleState.None)];
    }
    // Group by YYYY-MM, newest month first
    const byMonth = new Map<string, Record<string, unknown>[]>();
    for (const s of sessions) {
      const ts = this.sessionSortBy === 'updated'
        ? ((s['last_turn_at'] ?? s['created_at']) as string)
        : ((s['created_at'] ?? s['last_turn_at']) as string);
      const d = new Date(ts);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (!byMonth.has(key)) byMonth.set(key, []);
      byMonth.get(key)!.push(s);
    }
    const now = new Date();
    const thisMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonthKey = `${lastMonth.getFullYear()}-${String(lastMonth.getMonth() + 1).padStart(2, '0')}`;
    const monthLabel = (key: string): string => {
      if (key === thisMonthKey) return 'This month';
      if (key === lastMonthKey) return 'Last month';
      const [yr, mo] = key.split('-').map(Number);
      return new Date(yr, mo - 1, 1).toLocaleDateString([], { month: 'long', year: 'numeric' });
    };
    const sortedMonths = [...byMonth.keys()].sort((a, b) => b.localeCompare(a));
    return sortedMonths.map((key) => {
      const monthSessions = byMonth.get(key)!;
      const item = new SidePanelItem(
        `${monthLabel(key)}   ${monthSessions.length}`,
        vscode.TreeItemCollapsibleState.Collapsed,
        `sessions:older:${key}`,
      );
      item.iconPath = new vscode.ThemeIcon('calendar');
      return item;
    });
  }

  private sessionOlderMonthChildren(monthKey: string): SidePanelItem[] {
    const data = this.loadAndBucketSessions(this.sessionSortBy);
    const sessions = data.older.filter((s) => {
      const ts = this.sessionSortBy === 'updated'
        ? ((s['last_turn_at'] ?? s['created_at']) as string)
        : ((s['created_at'] ?? s['last_turn_at']) as string);
      const d = new Date(ts);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      return key === monthKey;
    });
    if (sessions.length === 0) {
      return [new SidePanelItem('(none)', vscode.TreeItemCollapsibleState.None)];
    }
    return sessions.map((s) => this.sessionRow(s, true));
  }

  private sessionLast7dChildren(): SidePanelItem[] {
    const data = this.loadAndBucketSessions(this.sessionSortBy);
    const sessions = data.last7d;
    if (sessions.length === 0) {
      return [new SidePanelItem('(none)', vscode.TreeItemCollapsibleState.None)];
    }
    // Group by local date, newest date first
    const byDate = new Map<string, Record<string, unknown>[]>();
    for (const s of sessions) {
      const ts = this.sessionSortBy === 'updated'
        ? ((s['last_turn_at'] ?? s['created_at']) as string)
        : ((s['created_at'] ?? s['last_turn_at']) as string);
      const dateStr = this.localDateStr(ts);
      if (!byDate.has(dateStr)) byDate.set(dateStr, []);
      byDate.get(dateStr)!.push(s);
    }
    const sortedDates = [...byDate.keys()].sort((a, b) => b.localeCompare(a));
    return sortedDates.map((dateStr) => {
      const daySessions = byDate.get(dateStr)!;
      const d = new Date(`${dateStr}T12:00:00`);
      const dayLabel = d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
      const item = new SidePanelItem(`${dayLabel}   ${daySessions.length}`, vscode.TreeItemCollapsibleState.Collapsed, `sessions:last7d:${dateStr}`);
      item.iconPath = new vscode.ThemeIcon('calendar');
      return item;
    });
  }

  private sessionDateChildren(dateStr: string): SidePanelItem[] {
    const data = this.loadAndBucketSessions(this.sessionSortBy);
    const sessions = data.last7d.filter((s) => {
      const ts = this.sessionSortBy === 'updated'
        ? ((s['last_turn_at'] ?? s['created_at']) as string)
        : ((s['created_at'] ?? s['last_turn_at']) as string);
      return this.localDateStr(ts) === dateStr;
    });
    if (sessions.length === 0) {
      return [new SidePanelItem('(none)', vscode.TreeItemCollapsibleState.None)];
    }
    return sessions.map((s) => this.sessionRow(s));
  }

  private sessionRow(s: Record<string, unknown>, showDate = false): SidePanelItem {
    const tool = (s['tool'] as string) || '???';
    const projectPath = (s['project_path'] as string) || '';
    const projectName = projectPath ? path.basename(projectPath) : '(unknown)';
    const createdAt = (s['created_at'] as string) || '';
    const lastTurnAt = (s['last_turn_at'] as string) || '';
    const turnCount = (s['turn_count'] as number) ?? 0;
    const wwuid = (s['wwuid'] as string) || '';
    const ts = this.sessionSortBy === 'updated' ? (lastTurnAt || createdAt) : (createdAt || lastTurnAt);
    const d = ts ? new Date(ts) : null;
    const timeStr = d ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
    const dateStr = d ? d.toLocaleDateString([], { month: 'short', day: 'numeric' }) : '';
    const TOOL_ICONS: Record<string, string> = { cpt: 'github', cld: 'comment-discussion', ccx: 'circuit-board' };
    const label = showDate
      ? `[${tool}] ${dateStr}  ${projectName}  ${timeStr}  ${turnCount}↕`
      : `[${tool}] ${projectName}  ${timeStr}  ${turnCount}↕`;
    const item = new SidePanelItem(label, vscode.TreeItemCollapsibleState.None);
    item.iconPath = new vscode.ThemeIcon(TOOL_ICONS[tool] ?? 'symbol-misc');
    item.tooltip = new vscode.MarkdownString(
      `**${projectName}**\n\n\`${projectPath}\`\n\nCreated: \`${createdAt}\`  \nLast turn: \`${lastTurnAt}\`  \nTurns: ${turnCount}  \nTool: ${tool}`
    );
    // Open session JSON on click
    if (wwuid && this.exportPath) {
      const jsonPath = path.join(this.exportPath, 'staged', 'storage', 'sessions', `${wwuid}.json`);
      item.command = {
        command: 'vscode.open',
        title: 'Open Session JSON',
        arguments: [vscode.Uri.file(jsonPath)],
      };
    }
    return item;
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
      action('Rebuild Index', 'wildwest.rebuildIndex', 'database'),
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

  private timeAgo(ts: string): string {
    if (!ts || ts === '—') return '—';
    try {
      const ms = Date.now() - new Date(ts).getTime();
      if (ms < 0) return 'just now';
      const sec = Math.floor(ms / 1000);
      if (sec < 60) return `${sec}s ago`;
      const min = Math.floor(sec / 60);
      if (min < 60) return `${min}m ago`;
      const hr = Math.floor(min / 60);
      if (hr < 24) return `${hr}h ago`;
      const day = Math.floor(hr / 24);
      return `${day}d ago`;
    } catch { return ts; }
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
