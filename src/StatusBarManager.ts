import * as vscode from 'vscode';
import { HeartbeatMonitor } from './HeartbeatMonitor';

/**
 * StatusBarManager — single unified Wild West status bar item.
 *
 * Text format:  $(eye) ● Actor · Scope   (watching + actor declared + heartbeat alive)
 *               $(eye) ○ Scope            (watching + no actor + heartbeat stopped)
 *               $(eye-closed) ● Actor · Scope  (not watching + actor + alive)
 *               $(eye-closed) ○ Scope           (not watching + no actor)
 *
 * Click: focuses the Wild West side panel.
 * Tooltip: rich MarkdownString with all session + governance action links.
 */
export class StatusBarManager {
  private statusBarItem: vscode.StatusBarItem;
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
      return;
    }

    const actorSetting = vscode.workspace.getConfiguration('wildwest').get<string>('actor', '');
    const scopeLabel = scope.charAt(0).toUpperCase() + scope.slice(1);
    const liveness = this.heartbeatMonitor.checkLiveness();
    const eyeIcon = this.isWatching ? '$(eye)' : '$(eye-closed)';
    const heartDot = liveness === 'alive' ? '●' : liveness === 'flagged' ? '⚑' : '○';

    if (actorSetting) {
      this.statusBarItem.text = `${eyeIcon} ${heartDot} ${actorSetting} · ${scopeLabel}`;
      this.statusBarItem.color = new vscode.ThemeColor('statusBar.foreground');
    } else {
      this.statusBarItem.text = `${eyeIcon} ${heartDot} ${scopeLabel}`;
      this.statusBarItem.color = new vscode.ThemeColor('statusBarItem.warningForeground');
    }

    this.statusBarItem.tooltip = this.createTooltip();
    this.statusBarItem.show();
  }

  private createTooltip(): vscode.MarkdownString {
    const tooltip = new vscode.MarkdownString('', true);
    tooltip.isTrusted = true;
    tooltip.supportHtml = true;

    tooltip.appendMarkdown('**Wild West**\n\n');

    if (this.isWatching) {
      tooltip.appendMarkdown('Session: $(eye) Watching\n\n');
      tooltip.appendMarkdown('[$(debug-pause) Stop Watcher](command:wildwest.stopWatcher)\n\n');
    } else {
      tooltip.appendMarkdown('Session: $(eye-closed) Stopped\n\n');
      tooltip.appendMarkdown('[$(play) Start Watcher](command:wildwest.startWatcher)\n\n');
    }

    tooltip.appendMarkdown('---\n\n');
    tooltip.appendMarkdown('**Sessions**\n\n');
    tooltip.appendMarkdown('[$(sync) Export Now](command:wildwest.exportNow)\n\n');
    tooltip.appendMarkdown('[$(package) Batch Convert to JSON](command:wildwest.batchConvert)\n\n');
    tooltip.appendMarkdown('[$(file-text) Convert to Markdown](command:wildwest.convertToMarkdown)\n\n');
    tooltip.appendMarkdown('[$(list-unordered) Generate Index](command:wildwest.generateIndex)\n\n');

    tooltip.appendMarkdown('---\n\n');
    tooltip.appendMarkdown('**Governance**\n\n');
    tooltip.appendMarkdown('[$(radio-tower) View Telegraph](command:wildwest.viewTelegraph)\n\n');
    tooltip.appendMarkdown('[$(pulse) Solo Mode Report](command:wildwest.soloModeReport)\n\n');

    tooltip.appendMarkdown('---\n\n');
    tooltip.appendMarkdown('[$(folder-opened) Open Export Folder](command:wildwest.openExportFolder)\n\n');
    tooltip.appendMarkdown('[$(output) View Output Log](command:wildwest.viewOutputLog)\n\n');
    tooltip.appendMarkdown('[$(gear) Settings](command:wildwest.openSettings)\n\n');

    return tooltip;
  }

  startListening(): void {
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('wildwest.actor')) {
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
  }
}
