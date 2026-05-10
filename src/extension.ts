import * as path from 'path';
import * as vscode from 'vscode';
import { SessionExporter } from './sessionExporter';
import { HeartbeatMonitor } from './HeartbeatMonitor';
import { StatusBarManager } from './StatusBarManager';
import { SoloModeController } from './SoloModeController';
import { TelegraphWatcher } from './TelegraphWatcher';
import { WorktreeManager } from './WorktreeManager';
import { initTown, initCounty, initTerritory } from './TownInit';
import { TelegraphInbox } from './TelegraphInbox';
import { TelegraphCommands } from './TelegraphCommands';
import { AIToolBridge } from './AIToolBridge';
import { ClaudeCodeAdapter } from './aiToolAdapters/ClaudeCodeAdapter';
import { registerChatParticipant } from './WildwestParticipant';
import { registerMCPServer } from './mcp/wwMCPServer';
import { runDoctor } from './WildwestDoctor';
import { runValidateRegistry } from './RegistryValidator';
import { SidePanelProvider } from './SidePanelProvider';
import { getDeliveryReceipts, statusIcon } from './DeliveryReceipts';
import { getTelegraphDirs } from './TelegraphService';
import { SessionPreviewProvider, SESSION_PREVIEW_SCHEME } from './SessionPreviewProvider';
import { TelegraphPanel } from './TelegraphPanel';

// ── Configuration types & helpers ──────────────────────────────────────────

interface WildwestConfig {
  worldRoot: string;
  countiesDir: string;
  sessionsDir: string;
}

function getWildwestConfig(): WildwestConfig {
  const cfg = vscode.workspace.getConfiguration('wildwest');
  const home = process.env['HOME'] ?? '~';
  const worldRoot = (cfg.get<string>('worldRoot') ?? '~/wildwest').replace(/^~/, home);
  const countiesDir = cfg.get<string>('countiesDir') ?? 'counties';
  const sessionsDir = cfg.get<string>('sessionsDir') ?? 'sessions';
  return { worldRoot, countiesDir, sessionsDir };
}

let exporter: SessionExporter;
let heartbeatMonitor: HeartbeatMonitor;
let statusBarManager: StatusBarManager;
let telegraphWatcher: TelegraphWatcher;
let soloModeController: SoloModeController;
let worktreeManager: WorktreeManager;
let telegraphCommands: TelegraphCommands;
let telegraphInbox: TelegraphInbox;
let aiToolBridge: AIToolBridge;
let sidePanelProvider: SidePanelProvider;
let outputChannel: vscode.OutputChannel;

export function activate(context: vscode.ExtensionContext) {
  outputChannel = vscode.window.createOutputChannel('Wild West');
  outputChannel.appendLine('Wild West extension activated');

  // Get Wild West config
  const wwConfig = getWildwestConfig();

  // ── Core components ───────────────────────────────────────────────────────
  worktreeManager = new WorktreeManager();
  exporter = new SessionExporter(context, outputChannel);
  heartbeatMonitor = new HeartbeatMonitor(outputChannel, wwConfig.worldRoot, wwConfig.countiesDir);
  statusBarManager = new StatusBarManager(heartbeatMonitor);
  // Notify status bar and side panel whenever the session watcher starts/stops
  exporter.setWatchingCallback((isWatching) => {
    statusBarManager.setWatching(isWatching);
    sidePanelProvider?.setWatching(isWatching);
  });
  telegraphWatcher = new TelegraphWatcher(outputChannel, worktreeManager, heartbeatMonitor);
  soloModeController = new SoloModeController(outputChannel, worktreeManager, heartbeatMonitor);
  telegraphInbox = new TelegraphInbox(outputChannel);
  telegraphCommands = new TelegraphCommands(outputChannel, heartbeatMonitor, exporter.getExportPath());
  telegraphCommands.register(context);

  // ── AI Tool Bridge ────────────────────────────────────────────────────────
  // All scope levels (town, county, territory) register the adapter.
  // Claude Code sessions can run in any scope window. Port conflicts are
  // handled via auto-retry — only one window binds at a time.
  aiToolBridge = new AIToolBridge(outputChannel);
  aiToolBridge.registerAdapter(new ClaudeCodeAdapter(outputChannel));
  aiToolBridge.onEvent((event) => {
    // turn-end and file-changed → trigger outbox delivery immediately
    if (event.type === 'turn-end' || event.type === 'file-changed') {
      heartbeatMonitor.deliverOutboxNow();
    }
  });
  aiToolBridge.start();

  // ── Session preview (virtual document, read-only markdown) ─────────────
  const sessionPreviewProvider = new SessionPreviewProvider();
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(SESSION_PREVIEW_SCHEME, sessionPreviewProvider),
    vscode.commands.registerCommand('wildwest.openSessionPreview', async (wwuid: string, exportPath: string) => {
      const uri = SessionPreviewProvider.uriFor(wwuid, exportPath);
      await vscode.commands.executeCommand('markdown.showPreview', uri);
    }),
  );

  // ── Side panel (TreeView) ─────────────────────────────────────────────────
  sidePanelProvider = new SidePanelProvider(heartbeatMonitor);
  sidePanelProvider.setExportPath(exporter.getExportPath());
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('wildwest.sidepanel', sidePanelProvider),
    vscode.commands.registerCommand('wildwest.refreshSidePanel', () =>
      sidePanelProvider.refresh(),
    ),
    sidePanelProvider,
  );

  // ── @wildwest Copilot Chat participant (P3) ───────────────────────────────
  registerChatParticipant(context, outputChannel);

  // ── wwMCP server (P6) — stdio, opt-in via wildwest.mcp.enabled ───────────
  registerMCPServer(context, outputChannel, heartbeatMonitor);

  // ── Commands — dyad log (existing) ─────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('wildwest.startWatcher', () => exporter.start()),
    vscode.commands.registerCommand('wildwest.stopWatcher', () => exporter.stop()),
    vscode.commands.registerCommand('wildwest.exportNow', () => exporter.exportNow()),
    vscode.commands.registerCommand('wildwest.toggleSessionSortBy', () => sidePanelProvider?.toggleSessionSortBy()),
    vscode.commands.registerCommand('wildwest.rebuildIndex', () => exporter.rebuildIndex()),
    vscode.commands.registerCommand('wildwest.seedSessionMap', () => exporter.seedSessionMap()),
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
    vscode.commands.registerCommand('wildwest.setIdentity', async () => {
      const current = vscode.workspace.getConfiguration('wildwest').get<string>('identity', '');
      const value = await vscode.window.showInputBox({
        title: 'Set Wild West Identity',
        prompt: 'Format: Role(dyad)  e.g. TM(RHk)  or  CD(RSn)',
        value: current,
        placeHolder: 'TM(RHk)',
      });
      if (value !== undefined) {
        await vscode.workspace.getConfiguration('wildwest').update('identity', value, vscode.ConfigurationTarget.Global);
        sidePanelProvider?.refresh();
      }
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
        { label: 'Export Dyad Log Now',       command: 'wildwest.exportNow' },
        { label: 'Batch Convert All Sessions',command: 'wildwest.batchConvert' },
        { label: 'Convert Exports to Markdown', command: 'wildwest.convertToMarkdown' },
        { label: 'Generate Index',            command: 'wildwest.generateIndex' },
        { label: 'Governance', kind: vscode.QuickPickItemKind.Separator },
        { label: 'Init Town',                 command: 'wildwest.initTown' },
        { label: 'Init County',               command: 'wildwest.initCounty' },
        { label: 'Init Territory',            command: 'wildwest.initTerritory' },
        { label: 'Process Inbox',             command: 'wildwest.processInbox' },
        { label: 'View Telegraph',            command: 'wildwest.viewTelegraph' },
        { label: 'Delivery Receipts',         command: 'wildwest.showReceipts' },
        { label: 'Solo Mode Report',          command: 'wildwest.soloModeReport' },
        { label: 'Settings', kind: vscode.QuickPickItemKind.Separator },
        { label: 'Reset Session Export Consent', command: 'wildwest.resetSessionConsent' },
        { label: 'Validate Registry',            command: 'wildwest.validateRegistry' },
        { label: 'Wild West Doctor',             command: 'wildwest.doctor' },
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

  // ── Command — town/county/territory init ──────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('wildwest.initTown', () => initTown(outputChannel)),
    vscode.commands.registerCommand('wildwest.initCounty', () => initCounty(outputChannel)),
    vscode.commands.registerCommand('wildwest.initTerritory', () => initTerritory(outputChannel)),
  );

  // ── Command — telegraph inbox (rule 23 enforcement) ───────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('wildwest.processInbox', () => telegraphInbox.processInbox()),
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
    vscode.commands.registerCommand('wildwest.restartAdapter', async () => {
      outputChannel.appendLine('[wildwest] restarting AI tool adapter...');
      await aiToolBridge.stop();
      await aiToolBridge.start();
      outputChannel.appendLine('[wildwest] AI tool adapter restarted');
      vscode.window.showInformationMessage('Wild West: AI tool adapter restarted.');
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
    vscode.commands.registerCommand('wildwest.showStatus', () => {
      const scope = heartbeatMonitor.detectScope();
      const identity = vscode.workspace.getConfiguration('wildwest').get<string>('identity', '');
      const info = scope ? `Scope: ${scope}\nIdentity: ${identity || '(not declared)'}` : 'No Wild West scope detected';
      vscode.window.showInformationMessage(`Wild West Status\n${info}`);
    }),
    vscode.commands.registerCommand('wildwest.resetSessionConsent', () => {
      context.globalState.update('wildwest.sessionScanConsented', false);
      exporter.stop();
      vscode.window.showInformationMessage(
        'Wild West: Session export consent reset. Reload window to be prompted again.',
      );
      outputChannel.appendLine('[wildwest] session export consent reset by user');
    }),
    vscode.commands.registerCommand('wildwest.validateRegistry', () =>
      runValidateRegistry(outputChannel),
    ),
    vscode.commands.registerCommand('wildwest.doctor', () =>
      runDoctor(context, outputChannel, heartbeatMonitor),
    ),
    vscode.commands.registerCommand('wildwest.openTelegraphPanel', () => {
      TelegraphPanel.open(exporter.getExportPath());
    }),
    vscode.commands.registerCommand('wildwest.showReceipts', async () => {
      const allReceipts = getTelegraphDirs().flatMap((dir) => getDeliveryReceipts(dir));
      if (allReceipts.length === 0) {
        vscode.window.showInformationMessage('Wild West: no sent memos found.');
        return;
      }
      const items = allReceipts.map((r) => ({
        label: `${statusIcon(r.status)} ${r.subject}`,
        description: r.status + (r.deliveredAt ? ` · ${r.deliveredAt}` : ''),
        receipt: r,
      }));
      const pick = await vscode.window.showQuickPick(items, {
        placeHolder: 'Delivery receipts — select to open memo',
        matchOnDescription: true,
      });
      if (pick) {
        vscode.commands.executeCommand('vscode.open', vscode.Uri.file(pick.receipt.filePath));
      }
    }),
  );

  // ── Auto-start ────────────────────────────────────────────────────────────
  const config = vscode.workspace.getConfiguration('wildwest');
  if (config.get<boolean>('enabled') !== false) {
    statusBarManager.startListening();
    heartbeatMonitor.start();
    telegraphWatcher.start();

    // Session export requires explicit first-run consent (OWASP A01: access
    // control — don't read user data stores without permission).
    const CONSENT_KEY = 'wildwest.sessionScanConsented';
    const consented = context.globalState.get<boolean>(CONSENT_KEY, false);
    if (consented) {
      exporter.start();
    } else {
      vscode.window
        .showInformationMessage(
          'Wild West: Allow session export? The extension can read Copilot chat sessions and export them to your sessions directory.',
          'Allow',
          'Not now',
        )
        .then((choice) => {
          if (choice === 'Allow') {
            context.globalState.update(CONSENT_KEY, true);
            exporter.start();
            outputChannel.appendLine('[wildwest] session export consent granted');
          } else {
            outputChannel.appendLine('[wildwest] session export skipped — consent not given');
          }
        });
    }
  }

  // ── Config change listener ────────────────────────────────────────────────
  context.subscriptions.push(
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
    }),
  );

  context.subscriptions.push(heartbeatMonitor, telegraphWatcher, soloModeController, statusBarManager);
}

export async function deactivate(): Promise<void> {
  await exporter?.stop(true);
  exporter?.dispose();
  heartbeatMonitor?.dispose();
  telegraphWatcher?.dispose();
  statusBarManager?.dispose();
  sidePanelProvider?.dispose();
  await aiToolBridge?.stop();
}
