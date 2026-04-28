import * as vscode from 'vscode';
import { ChatExporter } from './chatExporter';

let exporter: ChatExporter;
let outputChannel: vscode.OutputChannel;

export function activate(context: vscode.ExtensionContext) {
  // Create output channel
  outputChannel = vscode.window.createOutputChannel('Wild West');
  outputChannel.appendLine('Wild West extension activated');
  outputChannel.show(true);
  
  console.log('Wild West extension activated');

  exporter = new ChatExporter(context, outputChannel);

  // Register commands
  const startCmd = vscode.commands.registerCommand('wildwest.startWatcher', () => {
    exporter.start();
  });

  const stopCmd = vscode.commands.registerCommand('wildwest.stopWatcher', () => {
    exporter.stop();
  });

  const exportCmd = vscode.commands.registerCommand('wildwest.exportNow', () => {
    exporter.exportNow();
  });

  const batchConvertCmd = vscode.commands.registerCommand('wildwest.batchConvert', () => {
    exporter.batchConvertSessions();
  });

  const convertMarkdownCmd = vscode.commands.registerCommand('wildwest.convertToMarkdown', () => {
    exporter.convertExportsToMarkdown();
  });

  const generateIndexCmd = vscode.commands.registerCommand('wildwest.generateIndex', () => {
    exporter.generateMarkdownIndex();
  });

  const openExportFolderCmd = vscode.commands.registerCommand('wildwest.openExportFolder', () => {
    const exportPath = exporter.getExportPath();
    vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(exportPath));
  });

  const viewOutputLogCmd = vscode.commands.registerCommand('wildwest.viewOutputLog', () => {
    outputChannel.show();
  });

  const openSettingsCmd = vscode.commands.registerCommand('wildwest.openSettings', () => {
    vscode.commands.executeCommand('workbench.action.openSettings', 'wildwest');
  });

  context.subscriptions.push(
    startCmd, 
    stopCmd, 
    exportCmd, 
    batchConvertCmd, 
    convertMarkdownCmd,
    generateIndexCmd,
    openExportFolderCmd,
    viewOutputLogCmd,
    openSettingsCmd
  );

  // Auto-start if enabled in settings
  const config = vscode.workspace.getConfiguration('wildwest');
  const enabled = config.get<boolean>('enabled');
  outputChannel.appendLine(`Auto-start config: enabled=${enabled}`);
  
  if (enabled !== false) {
    outputChannel.appendLine('Auto-starting chat export watcher...');
    exporter.start();
  } else {
    outputChannel.appendLine('Auto-start disabled in settings');
  }

  // Watch for configuration changes
  vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration('wildwest')) {
      const newConfig = vscode.workspace.getConfiguration('wildwest');
      if (newConfig.get<boolean>('enabled') && !exporter) {
        exporter = new ChatExporter(context, outputChannel);
        exporter.start();
      }
    }
  });
}

export function deactivate() {
  if (exporter) {
    exporter.dispose();
  }
}
