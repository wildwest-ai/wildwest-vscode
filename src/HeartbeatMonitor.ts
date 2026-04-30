import { exec } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { WorktreeManager } from './WorktreeManager';

const STALE_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes

export type HeartbeatState = 'alive' | 'flagged' | 'stopped';

export class HeartbeatMonitor {
  private timer: ReturnType<typeof setInterval> | null = null;
  private statusBarItem: vscode.StatusBarItem;
  private state: HeartbeatState = 'stopped';
  private outputChannel: vscode.OutputChannel;
  private worktreeManager: WorktreeManager;
  private govCache: { branch: string; worktreeCount: number } = { branch: '?', worktreeCount: 0 };

  constructor(outputChannel: vscode.OutputChannel, worktreeManager: WorktreeManager) {
    this.outputChannel = outputChannel;
    this.worktreeManager = worktreeManager;
    this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.statusBarItem.command = 'wildwest.viewTelegraph';
    this.statusBarItem.show();
    this.updateStatusBar();
    this.refreshGovCache();
  }

  start(): void {
    if (this.timer) return;
    const intervalMs = vscode.workspace
      .getConfiguration('wildwest')
      .get<number>('heartbeatInterval', 300_000);
    this.beat();
    this.timer = setInterval(() => this.beat(), intervalMs);
    this.outputChannel.appendLine(`[HeartbeatMonitor] started — interval=${intervalMs}ms`);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.state = 'stopped';
    this.updateStatusBar();
    this.outputChannel.appendLine('[HeartbeatMonitor] stopped');
  }

  isRunning(): boolean {
    return this.timer !== null;
  }

  checkLiveness(): HeartbeatState {
    const sentinel = this.sentinelPath();
    if (!sentinel) return 'stopped';
    try {
      const stat = fs.statSync(sentinel);
      const ageMs = Date.now() - stat.mtimeMs;
      return ageMs < STALE_THRESHOLD_MS ? this.state : 'stopped';
    } catch {
      return 'stopped';
    }
  }

  setFlagged(flagged: boolean): void {
    if (this.state === 'stopped') return;
    this.state = flagged ? 'flagged' : 'alive';
    this.updateStatusBar();
  }

  dispose(): void {
    this.stop();
    this.statusBarItem.dispose();
  }

  /**
   * Returns the workspace folder that is a governed Wild West town.
   * Prefers the first folder that has `.wildwest/` initialized; falls back to folders[0].
   * This handles multi-root workspaces where the governed town is not folders[0].
   */
  private getTownRoot(): string | null {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) return null;
    // A properly initialized town has .wildwest/scripts/ (created by initTown).
    // wildwest-framework only has .wildwest/telegraph/ — not a full town.
    const governed = folders.find((f) =>
      fs.existsSync(path.join(f.uri.fsPath, '.wildwest', 'scripts')),
    );
    return (governed ?? folders[0]).uri.fsPath;
  }

  private sentinelPath(): string | null {
    const cwd = this.getTownRoot();
    return cwd ? path.join(cwd, '.wildwest', 'telegraph', '.last-beat') : null;
  }

  private beat(): void {
    const cwd = this.getTownRoot();
    if (!cwd) {
      this.state = 'stopped';
      this.updateStatusBar();
      return;
    }

    const telegraphDir = path.join(cwd, '.wildwest', 'telegraph');
    const sentinelPath = path.join(telegraphDir, '.last-beat');

    try {
      fs.mkdirSync(telegraphDir, { recursive: true });
      fs.writeFileSync(sentinelPath, new Date().toISOString() + '\n');
    } catch (err) {
      this.outputChannel.appendLine(`[HeartbeatMonitor] beat error: ${err}`);
      this.state = 'stopped';
      this.refreshGovCache();
      return;
    }

    // Scan telegraph for flag files (skip sentinel and history dir)
    let flagged = false;
    try {
      flagged = fs.readdirSync(telegraphDir).some(
        (e) => !e.startsWith('.') && e !== 'history' && !e.includes('-heartbeat--'),
      );
    } catch { /* no flags */ }

    this.state = flagged ? 'flagged' : 'alive';
    this.outputChannel.appendLine(`[HeartbeatMonitor] beat — state=${this.state}`);
    this.refreshGovCache();
  }

  private refreshGovCache(): void {
    const cwd = this.getTownRoot();

    const updateWorktreeCount = () => {
      const worktrees = this.worktreeManager.list();
      this.govCache.worktreeCount = worktrees.filter((w) => !w.isHeartbeat && !w.isMain).length;
      this.updateStatusBar();
    };

    if (cwd) {
      exec('git rev-parse --abbrev-ref HEAD', { cwd, encoding: 'utf8' }, (err, stdout) => {
        if (!err) {
          this.govCache.branch = stdout.trim();
        }
        updateWorktreeCount();
      });
    } else {
      updateWorktreeCount();
    }
  }

  private getGovInfo(): { branch: string; tier: number; worktreeCount: number } {
    const { branch, worktreeCount } = this.govCache;
    const cwd = this.getTownRoot();

    let tier = 4;
    if (this.state !== 'stopped' && cwd) {
      const hasBranchDoc = fs.existsSync(
        path.join(cwd, '.wildwest', 'board', 'branches', 'active', branch, 'README.md'),
      );
      tier = hasBranchDoc ? 2 : 1;
    }

    return { branch, tier, worktreeCount };
  }

  private updateStatusBar(): void {
    const { branch, tier, worktreeCount } = this.getGovInfo();
    const wtLabel = worktreeCount === 1 ? '1 wt' : `${worktreeCount} wt`;

    switch (this.state) {
      case 'alive':
        this.statusBarItem.text = `● Wild West  $(git-branch) ${branch}  T${tier}  ${wtLabel}`;
        this.statusBarItem.tooltip = `Heartbeat alive — no flags\nBranch: ${branch}  |  Solo Tier ${tier}  |  ${wtLabel}`;
        this.statusBarItem.color = undefined;
        break;
      case 'flagged':
        this.statusBarItem.text = `⚠ Wild West  $(git-branch) ${branch}  T${tier}  ${wtLabel}`;
        this.statusBarItem.tooltip = `Heartbeat alive — flags present (click to view telegraph)\nBranch: ${branch}  |  Solo Tier ${tier}  |  ${wtLabel}`;
        this.statusBarItem.color = new vscode.ThemeColor('statusBarItem.warningForeground');
        break;
      case 'stopped':
        this.statusBarItem.text = `○ Wild West  $(git-branch) ${branch}  T4  ${wtLabel}`;
        this.statusBarItem.tooltip = `Heartbeat stopped or stale — no _heartbeat worktree?\nBranch: ${branch}  |  Solo Tier 4 (no heartbeat)  |  ${wtLabel}`;
        this.statusBarItem.color = new vscode.ThemeColor('statusBarItem.errorForeground');
        break;
    }
  }
}
