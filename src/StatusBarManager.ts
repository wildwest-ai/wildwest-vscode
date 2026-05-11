import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { HeartbeatMonitor } from './HeartbeatMonitor';

/**
 * StatusBarManager — single unified Wild West status bar item.
 *
 * Text format:  $(eye) ● Identity · Scope   (watching + identity declared + heartbeat alive)
 *               $(eye) ○ Scope            (watching + no identity + heartbeat stopped)
 *               $(eye-closed) ● Identity · Scope  (not watching + identity + alive)
 *               $(eye-closed) ○ Scope           (not watching + no identity)
 *
 * Click: focuses the Wild West side panel.
 * Tooltip: rich MarkdownString with all session + governance action links.
 */
export class StatusBarManager {
  private statusBarItem: vscode.StatusBarItem;
  private identityBarItem: vscode.StatusBarItem;
  private heartbeatMonitor: HeartbeatMonitor;
  private disposables: vscode.Disposable[] = [];
  private refreshInterval: ReturnType<typeof setInterval> | null = null;
  private isWatching: boolean = false;

  constructor(heartbeatMonitor: HeartbeatMonitor) {
    this.heartbeatMonitor = heartbeatMonitor;
    this.statusBarItem = vscode.window.createStatusBarItem(
      'wildwest-status',
      vscode.StatusBarAlignment.Right,
      100,
    );
    this.statusBarItem.command = 'wildwest.sidepanel.focus';

    this.identityBarItem = vscode.window.createStatusBarItem(
      'wildwest-identity',
      vscode.StatusBarAlignment.Right,
      99,
    );
    this.identityBarItem.command = 'wildwest.setIdentity';
    this.identityBarItem.tooltip = 'Click to edit Wild West identity';
  }

  /** Called by SessionExporter when the watcher starts or stops. */
  setWatching(value: boolean): void {
    this.isWatching = value;
    this.updateDisplay();
  }

  updateDisplay(): void {
    const scope = this.heartbeatMonitor.detectScope();
    if (!scope) {
      this.statusBarItem.hide();
      this.identityBarItem.hide();
      return;
    }

    const identitySetting = vscode.workspace.getConfiguration('wildwest').get<string>('identity', '');
    const scopeLabel = scope.charAt(0).toUpperCase() + scope.slice(1);
    const liveness = this.heartbeatMonitor.checkLiveness();
    const eyeIcon = this.isWatching ? '$(eye)' : '$(eye-closed)';
    const heartDot = liveness === 'alive' ? '●' : liveness === 'flagged' ? '⚑' : '○';

    this.statusBarItem.text = `${eyeIcon} ${heartDot} ${scopeLabel}`;
    this.statusBarItem.color = new vscode.ThemeColor('statusBar.foreground');
    this.statusBarItem.tooltip = this.createTooltip();
    this.statusBarItem.show();

    if (identitySetting) {
      this.identityBarItem.text = `$(person) ${identitySetting}`;
      this.identityBarItem.show();
    } else {
      this.identityBarItem.text = `$(person) Set identity…`;
      this.identityBarItem.color = new vscode.ThemeColor('statusBarItem.warningForeground');
      this.identityBarItem.show();
    }
  }

  private createTooltip(): vscode.MarkdownString {
    const tooltip = new vscode.MarkdownString('', true);
    tooltip.isTrusted = true;
    tooltip.supportHtml = true;

    // Header: identity + scope
    const scope = this.heartbeatMonitor.detectScope();
    const scopeLabel = scope ? scope.charAt(0).toUpperCase() + scope.slice(1) : '—';
    const identitySetting = vscode.workspace.getConfiguration('wildwest').get<string>('identity', '');
    const header = identitySetting
      ? `**Wild West** · ${identitySetting} · ${scopeLabel}`
      : `**Wild West** · ${scopeLabel}`;
    tooltip.appendMarkdown(`${header}\n\n`);

    // Heartbeat state + last beat
    const liveness = this.heartbeatMonitor.checkLiveness();
    const heartDot = liveness === 'alive' ? '●' : liveness === 'flagged' ? '⚑' : '○';
    const lastBeat = this.timeSince(this.readSentinelTimestamp());
    tooltip.appendMarkdown(`${heartDot} ${liveness} · Last beat: ${lastBeat}\n\n`);

    // Watcher toggle (compact)
    const eyeIcon = this.isWatching ? '$(eye)' : '$(eye-closed)';
    const watcherState = this.isWatching ? 'Watching' : 'Stopped';
    const watcherToggleCmd = this.isWatching ? 'wildwest.stopWatcher' : 'wildwest.startWatcher';
    const watcherToggleLabel = this.isWatching ? 'Stop' : 'Start';
    tooltip.appendMarkdown(`${eyeIcon} ${watcherState} — [${watcherToggleLabel}](command:${watcherToggleCmd})\n\n`);

    // Telegraph quick-actions
    tooltip.appendMarkdown('---\n\n');
    tooltip.appendMarkdown('**Telegraph**\n\n');
    tooltip.appendMarkdown(
      '[$(mail) Send](command:wildwest.telegraphSend)' +
      ' · [$(check) Ack](command:wildwest.telegraphAck)' +
      ' · [$(radio-tower) Inbox](command:wildwest.viewTelegraph)' +
      ' · [$(pulse) Solo](command:wildwest.soloModeReport)\n\n'
    );

    // Footer (maintenance ops)
    tooltip.appendMarkdown('---\n\n');
    tooltip.appendMarkdown(
      '[$(output) Log](command:wildwest.viewOutputLog)' +
      ' · [$(gear) Settings](command:wildwest.openSettings)\n\n'
    );

    return tooltip;
  }

  /** Read the heartbeat sentinel file and return its raw content (ISO string). */
  private readSentinelTimestamp(): string {
    const wwRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!wwRoot) return '—';
    const scope = this.heartbeatMonitor.detectScope();
    const sentinelFile = scope === 'town'
      ? path.join(wwRoot, '.wildwest', 'telegraph', '.last-beat')
      : path.join(wwRoot, '.wildwest', '.last-beat');
    try {
      return fs.readFileSync(sentinelFile, 'utf8').trim() || '—';
    } catch {
      return '—';
    }
  }

  /** Convert an ISO timestamp string to a human-readable relative time. */
  private timeSince(isoStr: string): string {
    if (isoStr === '—') return '—';
    const then = new Date(isoStr).getTime();
    if (isNaN(then)) return isoStr;
    const diffMin = Math.floor((Date.now() - then) / 60_000);
    if (diffMin < 1) return 'just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    return `${Math.floor(diffMin / 60)}h ago`;
  }

  startListening(): void {
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('wildwest.identity')) {
          this.updateDisplay();
        }
      }),
    );

    this.disposables.push(
      vscode.workspace.onDidChangeWorkspaceFolders(() => {
        this.updateDisplay();
      }),
    );

    // Periodic refresh (every 5 seconds) to catch heartbeat state changes
    this.refreshInterval = setInterval(() => {
      this.updateDisplay();
    }, 5000);

    this.updateDisplay();
  }

  dispose(): void {
    if (this.refreshInterval !== null) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables = [];
    this.statusBarItem.dispose();
    this.identityBarItem.dispose();
  }
}
