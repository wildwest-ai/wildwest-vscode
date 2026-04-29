import { exec, execSync } from 'child_process';
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

  constructor(outputChannel: vscode.OutputChannel, worktreeManager: WorktreeManager) {
    this.outputChannel = outputChannel;
    this.worktreeManager = worktreeManager;
    this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.statusBarItem.command = 'wildwest.viewTelegraph';
    this.statusBarItem.show();
    this.updateStatusBar();
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
    const hwt = this.worktreeManager.getHeartbeatWorktree();
    if (!hwt) return 'stopped';
    const sentinel = path.join(hwt.path, '.wildwest', 'telegraph', '.last-beat');
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

  private beat(): void {
    const hwt = this.worktreeManager.getHeartbeatWorktree();
    if (!hwt) {
      this.outputChannel.appendLine('[HeartbeatMonitor] no _heartbeat worktree found — skipping beat');
      this.state = 'stopped';
      this.updateStatusBar();
      return;
    }
    const scriptPath = path.join(hwt.path, '.wildwest', 'scripts', 'heartbeat.sh');
    exec(`bash "${scriptPath}"`, { cwd: hwt.path }, (err, stdout, stderr) => {
      if (stdout) this.outputChannel.appendLine(stdout.trim());
      if (stderr) this.outputChannel.appendLine(`[stderr] ${stderr.trim()}`);
      if (err) {
        this.outputChannel.appendLine(`[HeartbeatMonitor] beat error: ${err.message}`);
        this.state = 'stopped';
      } else {
        this.state = stdout.includes('flag') && !stdout.includes('flags=0') ? 'flagged' : 'alive';
      }
      this.updateStatusBar();
    });
  }

  private getGovInfo(): { branch: string; tier: number; worktreeCount: number } {
    const folders = vscode.workspace.workspaceFolders;
    const cwd = folders && folders.length > 0 ? folders[0].uri.fsPath : undefined;

    let branch = '?';
    if (cwd) {
      try {
        branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd, encoding: 'utf8' }).trim();
      } catch {
        // not a git repo or git unavailable
      }
    }

    const worktrees = this.worktreeManager.list();
    const nonHeartbeat = worktrees.filter((w) => !w.isHeartbeat);
    const worktreeCount = nonHeartbeat.length;

    let tier = 4;
    if (this.state !== 'stopped' && cwd) {
      const hasBranchDoc = fs.existsSync(
        path.join(cwd, 'docs', 'branches', 'active', branch, 'README.md'),
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
