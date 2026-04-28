import * as chokidar from 'chokidar';
import * as path from 'path';
import * as vscode from 'vscode';
import { HeartbeatMonitor } from './HeartbeatMonitor';
import { WorktreeManager } from './WorktreeManager';

const ATTENTION_PATTERNS = ['--ack-blocked--', '--ack-question--'];

export class TelegraphWatcher {
  private watchers: chokidar.FSWatcher[] = [];
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

  start(): void {
    this.stop();
    const worktrees = this.worktreeManager.list();
    for (const wt of worktrees) {
      const telegraphDir = path.join(wt.path, '.wildwest', 'telegraph');
      const watcher = chokidar.watch(telegraphDir, {
        ignoreInitial: false,
        depth: 0,
        persistent: true,
      });
      watcher.on('add', (filePath) => this.onFile(filePath));
      watcher.on('error', (err) => {
        this.outputChannel.appendLine(`[TelegraphWatcher] error watching ${telegraphDir}: ${err}`);
      });
      this.watchers.push(watcher);
      this.outputChannel.appendLine(`[TelegraphWatcher] watching ${telegraphDir}`);
    }
  }

  stop(): void {
    for (const w of this.watchers) {
      w.close().catch(() => {});
    }
    this.watchers = [];
  }

  dispose(): void {
    this.stop();
  }

  private onFile(filePath: string): void {
    const basename = path.basename(filePath);
    // ignore sentinel and heartbeat logs
    if (basename === '.last-beat' || basename.includes('-heartbeat--')) return;

    const needsAttention = ATTENTION_PATTERNS.some((p) => basename.includes(p));
    if (needsAttention) {
      this.heartbeatMonitor.setFlagged(true);
      const msg = `Wild West: attention needed — ${basename}`;
      this.outputChannel.appendLine(`[TelegraphWatcher] ${msg}`);
      vscode.window.showWarningMessage(msg, 'View Telegraph').then((choice) => {
        if (choice === 'View Telegraph') {
          vscode.commands.executeCommand('wildwest.viewTelegraph');
        }
      });
    }
  }
}
