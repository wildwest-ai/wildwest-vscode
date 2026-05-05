import * as vscode from 'vscode';
import { HeartbeatMonitor, WildWestScope } from './HeartbeatMonitor';

/**
 * StatusBarManager handles the Wild West status bar display.
 * Shows: ● <actor> · <scope> (when actor declared), or ○ <scope> (when no actor)
 */
export class StatusBarManager {
  private statusBarItem: vscode.StatusBarItem;
  private heartbeatMonitor: HeartbeatMonitor;

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
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('wildwest.actor')) {
        this.updateDisplay();
      }
    });

    // Update on workspace folder changes
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      this.updateDisplay();
    });

    // Initial display
    this.updateDisplay();
  }

  dispose(): void {
    this.statusBarItem.dispose();
  }
}
