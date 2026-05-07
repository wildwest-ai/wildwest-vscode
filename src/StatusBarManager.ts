import * as vscode from 'vscode';
import { HeartbeatMonitor } from './HeartbeatMonitor';

/**
 * StatusBarManager handles the Wild West status bar display.
 * Shows: ● <actor> · <scope> (when actor declared), or ○ <scope> (when no actor)
 */
export class StatusBarManager {
  private statusBarItem: vscode.StatusBarItem;
  private heartbeatMonitor: HeartbeatMonitor;
  private disposables: vscode.Disposable[] = [];
  private refreshInterval: ReturnType<typeof setInterval> | null = null;

  constructor(heartbeatMonitor: HeartbeatMonitor) {
    this.heartbeatMonitor = heartbeatMonitor;
    this.statusBarItem = vscode.window.createStatusBarItem('wildwest-status', vscode.StatusBarAlignment.Right, 100);
    this.statusBarItem.command = 'wildwest.showStatus';
    this.statusBarItem.tooltip = 'Wild West governance framework status';
  }

  /**
   * Update the status bar display based on current scope and declared actor.
   */
  updateDisplay(): void {
    const scope = this.heartbeatMonitor.detectScope();
    if (!scope) {
      this.statusBarItem.hide();
      return;
    }

    const actorSetting = vscode.workspace.getConfiguration('wildwest').get<string>('actor', '');
    const scopeLabel = scope.charAt(0).toUpperCase() + scope.slice(1);

    if (actorSetting) {
      // Actor declared: show ● <actor> · <scope>
      this.statusBarItem.text = `● ${actorSetting} · ${scopeLabel}`;
      this.statusBarItem.color = new vscode.ThemeColor('statusBar.foreground');
    } else {
      // No actor: show ○ <scope>
      this.statusBarItem.text = `○ ${scopeLabel}`;
      this.statusBarItem.color = new vscode.ThemeColor('statusBarItem.warningForeground');
    }

    this.statusBarItem.show();
  }

  /**
   * Start listening to configuration and editor changes to update display.
   */
  startListening(): void {
    // Update on actor or scope changes
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('wildwest.actor')) {
          this.updateDisplay();
        }
      }),
    );

    // Update on workspace folder changes
    this.disposables.push(
      vscode.workspace.onDidChangeWorkspaceFolders(() => {
        this.updateDisplay();
      }),
    );

    // Periodic refresh (every 5 seconds) to catch scope changes
    this.refreshInterval = setInterval(() => {
      this.updateDisplay();
    }, 5000);

    // Initial display
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
