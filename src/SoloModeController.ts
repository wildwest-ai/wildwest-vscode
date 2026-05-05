import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { HeartbeatMonitor } from './HeartbeatMonitor';
import { WorktreeManager } from './WorktreeManager';

// Autonomy tiers per docs/solo-mode.md
// Tier 1 — Maintenance (always autonomous)
// Tier 2 — Continuation (pre-approved, branch doc required)
// Tier 3 — Exploration (fork required)
// Tier 4 — Hard stop (never autonomous)
export type SoloTier = 1 | 2 | 3 | 4;

export class SoloModeController {
  private outputChannel: vscode.OutputChannel;
  private worktreeManager: WorktreeManager;
  private heartbeatMonitor: HeartbeatMonitor;

  constructor(
    outputChannel: vscode.OutputChannel,
    worktreeManager: WorktreeManager,
    heartbeatMonitor: HeartbeatMonitor,
  ) {
    this.outputChannel = outputChannel;
    this.worktreeManager = worktreeManager;
    this.heartbeatMonitor = heartbeatMonitor;
  }

  // Returns the effective autonomy tier for a given worktree path + branch.
  // Called by external actors (heartbeat log reader, future MCP) to gate actions.
  getTier(worktreePath: string, branch: string): SoloTier {
    if (!this.heartbeatAlive()) return 4;
    if (this.hasBranchDoc(worktreePath, branch)) return 2;
    return 1;
  }

  heartbeatAlive(): boolean {
    return this.heartbeatMonitor.checkLiveness() !== 'stopped';
  }

  hasBranchDoc(worktreePath: string, branch: string): boolean {
    const docPath = path.join(worktreePath, '.wildwest', 'board', 'branches', 'active', branch, 'README.md');
    return fs.existsSync(docPath);
  }

  // Log current tier for all non-heartbeat worktrees to the output channel.
  report(): void {
    const worktrees = this.worktreeManager.list().filter((w) => !w.isHeartbeat);
    if (worktrees.length === 0) {
      this.outputChannel.appendLine('[SoloModeController] no active worktrees');
      return;
    }
    for (const wt of worktrees) {
      const tier = this.getTier(wt.path, wt.branch);
      const hasBranchDoc = this.hasBranchDoc(wt.path, wt.branch);
      this.outputChannel.appendLine(
        `[SoloModeController] ${wt.branch} → Tier ${tier} (heartbeat=${this.heartbeatAlive()}, branchDoc=${hasBranchDoc})`,
      );
    }
  }

  dispose(): void {}
}
