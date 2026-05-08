import * as chokidar from 'chokidar';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { HeartbeatMonitor } from './HeartbeatMonitor';
import { WorktreeManager } from './WorktreeManager';

// Note: ATTENTION_PATTERNS kept for future use when handling ack-blocked/ack-question in inbox


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
      const inboxDir = path.join(telegraphDir, 'inbox');
      
      // Ensure inbox/ exists (may not exist on first run after upgrade)
      if (!fs.existsSync(inboxDir)) {
        try {
          fs.mkdirSync(inboxDir, { recursive: true });
        } catch (err) {
          this.outputChannel.appendLine(`[TelegraphWatcher] failed to create inbox: ${err}`);
        }
      }
      
      // Primary watcher: inbox/ directory (new outbox/inbox model)
      const inboxWatcher = chokidar.watch(inboxDir, {
        ignoreInitial: false,
        depth: 0,
        persistent: true,
      });
      inboxWatcher.on('add', (filePath) => this.onInboxFile(filePath));
      inboxWatcher.on('error', (err) => {
        this.outputChannel.appendLine(`[TelegraphWatcher] error watching ${inboxDir}: ${err}`);
      });
      this.watchers.push(inboxWatcher);
      this.outputChannel.appendLine(`[TelegraphWatcher] watching inbox: ${inboxDir}`);

      // Outbox watcher: trigger immediate delivery when a new memo is added
      const outboxDir = path.join(telegraphDir, 'outbox');
      if (!fs.existsSync(outboxDir)) {
        try {
          fs.mkdirSync(outboxDir, { recursive: true });
        } catch (err) {
          this.outputChannel.appendLine(`[TelegraphWatcher] failed to create outbox: ${err}`);
        }
      }
      const outboxWatcher = chokidar.watch(outboxDir, {
        ignoreInitial: true,
        depth: 0,
        persistent: true,
      });
      outboxWatcher.on('add', (filePath) => this.onOutboxFile(filePath));
      outboxWatcher.on('error', (err) => {
        this.outputChannel.appendLine(`[TelegraphWatcher] error watching ${outboxDir}: ${err}`);
      });
      this.watchers.push(outboxWatcher);
      this.outputChannel.appendLine(`[TelegraphWatcher] watching outbox: ${outboxDir}`);
      
      // Legacy watcher: telegraph root (migration period)
      // Watches for flat memos not in outbox/, inbox/, or history/
      const legacyWatcher = chokidar.watch(telegraphDir, {
        ignoreInitial: false,
        depth: 0,
        persistent: true,
      });
      legacyWatcher.on('add', (filePath) => this.onLegacyFile(filePath, telegraphDir));
      legacyWatcher.on('error', (err) => {
        this.outputChannel.appendLine(`[TelegraphWatcher] error watching legacy ${telegraphDir}: ${err}`);
      });
      this.watchers.push(legacyWatcher);
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

  private onOutboxFile(filePath: string): void {
    const basename = path.basename(filePath);
    if (!basename.endsWith('.md') || basename.startsWith('.') || basename.startsWith('!')) {
      return;
    }
    // Guard: file must exist and have content — prevents double-fire when delivery
    // moves the file before a second chokidar event fires against the same path.
    try {
      const stat = fs.statSync(filePath);
      if (stat.size === 0) { return; }
    } catch {
      return; // File already gone — delivery already handled it
    }
    this.outputChannel.appendLine(`[TelegraphWatcher] new outbox memo: ${basename} — triggering immediate delivery`);
    this.heartbeatMonitor.deliverOutboxNow();
  }

  private onInboxFile(filePath: string): void {
    const basename = path.basename(filePath);
    
    // Ignore sentinel, heartbeat logs, and meta files
    if (
      basename === '.last-beat' ||
      basename === '.gitkeep' ||
      basename.includes('-heartbeat--')
    ) {
      return;
    }

    // New memo in inbox = alert identity to process
    this.heartbeatMonitor.setFlagged(true);
    const msg = `Wild West: 📬 new memo in inbox — ${basename}`;
    this.outputChannel.appendLine(`[TelegraphWatcher] new inbox memo: ${basename}`);
    vscode.window.showWarningMessage(msg, 'Process Inbox', 'Dismiss').then((choice) => {
      if (choice === 'Process Inbox') {
        vscode.commands.executeCommand('wildwest.processInbox');
      }
    });
  }

  private onLegacyFile(filePath: string, telegraphDir: string): void {
    const basename = path.basename(filePath);
    const relDir = path.dirname(filePath).replace(telegraphDir, '').split(path.sep).filter(Boolean)[0];
    
    // Ignore files in outbox/, inbox/, history/, sentinel, and meta files
    if (
      relDir === 'outbox' ||
      relDir === 'inbox' ||
      relDir === 'history' ||
      basename === '.last-beat' ||
      basename === '.gitkeep' ||
      basename.includes('-heartbeat--')
    ) {
      return;
    }

    // Flat memo detected (legacy model) — flag for migration
    this.outputChannel.appendLine(
      `[TelegraphWatcher] MIGRATION: flat memo detected in telegraph root: ${basename}`,
    );
    this.outputChannel.appendLine(
      `[TelegraphWatcher] Run migration to move this to inbox/ or outbox/ as appropriate.`,
    );
  }
}
