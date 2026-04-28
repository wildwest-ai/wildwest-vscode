import * as path from 'path';
import * as vscode from 'vscode';
import { SessionExporter } from './sessionExporter';
import { HeartbeatMonitor } from './HeartbeatMonitor';
import { SoloModeController } from './SoloModeController';
import { TelegraphWatcher } from './TelegraphWatcher';
import { WorktreeManager } from './WorktreeManager';

let exporter: SessionExporter;
let heartbeatMonitor: HeartbeatMonitor;
let telegraphWatcher: TelegraphWatcher;
let soloModeController: SoloModeController;
let worktreeManager: WorktreeManager;
let outputChannel: vscode.OutputChannel;

export function activate(context: vscode.ExtensionContext) {
  outputChannel = vscode.window.createOutputChannel('Wild West');
  outputChannel.appendLine('Wild West extension activated');

  // ── Core components ───────────────────────────────────────────────────────
  worktreeManager = new WorktreeManager();
  exporter = new SessionExporter(context, outputChannel);
  heartbeatMonitor = new HeartbeatMonitor(outputChannel, worktreeManager);
  telegraphWatcher = new TelegraphWatcher(outputChannel, worktreeManager, heartbeatMonitor);
  soloModeController = new SoloModeController(outputChannel, worktreeManager, heartbeatMonitor);

  // ── Commands — devPair log (existing) ─────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('wildwest.startWatcher', () => exporter.start()),
    vscode.commands.registerCommand('wildwest.stopWatcher', () => exporter.stop()),
    vscode.commands.registerCommand('wildwest.exportNow', () => exporter.exportNow()),
    vscode.commands.registerCommand('wildwest.batchConvert', () => exporter.batchConvertSessions()),
    vscode.commands.registerCommand('wildwest.convertToMarkdown', () => exporter.convertExportsToMarkdown()),
    vscode.commands.registerCommand('wildwest.generateIndex', () => exporter.generateMarkdownIndex()),
    vscode.commands.registerCommand('wildwest.openExportFolder', () => {
      vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(exporter.getExportPath()));
    }),
    vscode.commands.registerCommand('wildwest.viewOutputLog', () => outputChannel.show()),
    vscode.commands.registerCommand('wildwest.openSettings', () => {
      vscode.commands.executeCommand('workbench.action.openSettings', 'wildwest');
    }),
  );

  // ── Command — grouped quick-pick menu ────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('wildwest.menu', async () => {
      type MenuItem = { label: string; kind?: vscode.QuickPickItemKind; command?: string };
      const ITEMS: MenuItem[] = [
        { label: 'Sessions', kind: vscode.QuickPickItemKind.Separator },
        { label: 'Start Watcher',             command: 'wildwest.startWatcher' },
        { label: 'Stop Watcher',              command: 'wildwest.stopWatcher' },
        { label: 'Export devPair Log Now',    command: 'wildwest.exportNow' },
        { label: 'Batch Convert All Sessions',command: 'wildwest.batchConvert' },
        { label: 'Convert Exports to Markdown', command: 'wildwest.convertToMarkdown' },
        { label: 'Generate Index',            command: 'wildwest.generateIndex' },
        { label: 'Governance', kind: vscode.QuickPickItemKind.Separator },
        { label: 'Start Heartbeat',           command: 'wildwest.startHeartbeat' },
        { label: 'Stop Heartbeat',            command: 'wildwest.stopHeartbeat' },
        { label: 'View Telegraph',            command: 'wildwest.viewTelegraph' },
        { label: 'Solo Mode Report',          command: 'wildwest.soloModeReport' },
      ];
      const commandMap = new Map(
        ITEMS.filter((i) => i.command).map((i) => [i.label, i.command!]),
      );
      const pick = await vscode.window.showQuickPick(
        ITEMS.map((i) => ({ label: i.label, kind: i.kind ?? vscode.QuickPickItemKind.Default })),
        { placeHolder: 'Wild West — select an action' },
      );
      if (pick) {
        const cmd = commandMap.get(pick.label);
        if (cmd) vscode.commands.executeCommand(cmd);
      }
    }),
  );

  // ── Commands — heartbeat ──────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('wildwest.startHeartbeat', () => {
      heartbeatMonitor.start();
      telegraphWatcher.start();
      outputChannel.appendLine('[wildwest] heartbeat started');
    }),
    vscode.commands.registerCommand('wildwest.stopHeartbeat', () => {
      heartbeatMonitor.stop();
      telegraphWatcher.stop();
      outputChannel.appendLine('[wildwest] heartbeat stopped');
    }),
    vscode.commands.registerCommand('wildwest.viewTelegraph', () => {
      const hwt = worktreeManager.getHeartbeatWorktree();
      if (!hwt) {
        vscode.window.showWarningMessage('Wild West: no _heartbeat worktree found');
        return;
      }
      const telegraphDir = path.join(hwt.path, '.wildwest', 'telegraph');
      vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(telegraphDir));
    }),
    vscode.commands.registerCommand('wildwest.soloModeReport', () => {
      soloModeController.report();
      outputChannel.show();
    }),
  );

  // ── Auto-start ────────────────────────────────────────────────────────────
  const config = vscode.workspace.getConfiguration('wildwest');
  if (config.get<boolean>('enabled') !== false) {
    exporter.start();
    heartbeatMonitor.start();
    telegraphWatcher.start();
  }

  // ── Config change listener ────────────────────────────────────────────────
  vscode.workspace.onDidChangeConfiguration((e) => {
    if (!e.affectsConfiguration('wildwest')) return;
    const newConfig = vscode.workspace.getConfiguration('wildwest');
    const enabled = newConfig.get<boolean>('enabled');
    if (enabled && !heartbeatMonitor.isRunning()) {
      heartbeatMonitor.start();
      telegraphWatcher.start();
    } else if (!enabled && heartbeatMonitor.isRunning()) {
      heartbeatMonitor.stop();
      telegraphWatcher.stop();
    }
  });

  context.subscriptions.push(heartbeatMonitor, telegraphWatcher, soloModeController);
}

export function deactivate() {
  exporter?.dispose();
  heartbeatMonitor?.dispose();
  telegraphWatcher?.dispose();
}
