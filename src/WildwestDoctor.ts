/**
 * Wild West Doctor
 *
 * Validates local Wild West setup and reports findings to the output channel.
 * Run via `wildwest.doctor` command.
 */

import * as fs from 'fs';
import * as net from 'net';
import * as path from 'path';
import * as vscode from 'vscode';
import { HeartbeatMonitor } from './HeartbeatMonitor';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type CheckStatus = 'ok' | 'warn' | 'fail' | 'info';

interface CheckResult {
  label: string;
  status: CheckStatus;
  detail: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ICON: Record<CheckStatus, string> = {
  ok:   '✅',
  warn: '⚠️ ',
  fail: '❌',
  info: 'ℹ️ ',
};

function portReachable(port: number, host: string, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    let resolved = false;
    const done = (ok: boolean) => {
      if (!resolved) {
        resolved = true;
        sock.destroy();
        resolve(ok);
      }
    };
    sock.setTimeout(timeoutMs);
    sock.on('connect', () => done(true));
    sock.on('error', () => done(false));
    sock.on('timeout', () => done(false));
    sock.connect(port, host);
  });
}

function findWwDir(): string | null {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) return null;
  const fp = folders[0].uri.fsPath;
  const candidate = path.join(fp, '.wildwest');
  return fs.existsSync(candidate) ? candidate : null;
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

function checkRegistry(wwDir: string): CheckResult {
  const regPath = path.join(wwDir, 'registry.json');
  if (!fs.existsSync(regPath)) {
    return { label: 'Registry', status: 'fail', detail: 'registry.json not found' };
  }
  try {
    const reg = JSON.parse(fs.readFileSync(regPath, 'utf8')) as Record<string, unknown>;
    const missing = ['alias', 'wwuid', 'county'].filter((k) => !reg[k]);
    if (missing.length > 0) {
      return { label: 'Registry', status: 'warn', detail: `missing fields: ${missing.join(', ')}` };
    }
    return {
      label: 'Registry',
      status: 'ok',
      detail: `${reg['alias']} (${String(reg['wwuid']).slice(0, 8)})`,
    };
  } catch {
    return { label: 'Registry', status: 'fail', detail: 'registry.json is not valid JSON' };
  }
}

function checkTelegraphDirs(wwDir: string): CheckResult {
  const telegraphDir = path.join(wwDir, 'telegraph');
  const required = ['inbox', 'outbox', path.join('outbox', 'history')];
  const missing = required.filter((d) => !fs.existsSync(path.join(telegraphDir, d)));
  if (!fs.existsSync(telegraphDir)) {
    return { label: 'Telegraph dirs', status: 'fail', detail: 'telegraph/ directory missing' };
  }
  if (missing.length > 0) {
    return { label: 'Telegraph dirs', status: 'warn', detail: `missing: ${missing.join(', ')}` };
  }
  return { label: 'Telegraph dirs', status: 'ok', detail: 'inbox/ outbox/ outbox/history/' };
}

function checkHeartbeat(wwDir: string, intervalMs: number): CheckResult {
  const sentinelPaths = [
    path.join(wwDir, 'telegraph', '.last-beat'), // town
    path.join(wwDir, '.last-beat'),               // county/territory
  ];
  const sentinel = sentinelPaths.find((p) => fs.existsSync(p));
  if (!sentinel) {
    return { label: 'Heartbeat', status: 'warn', detail: 'no .last-beat sentinel found' };
  }
  const mtime = fs.statSync(sentinel).mtimeMs;
  const ageMs = Date.now() - mtime;
  const ageMin = Math.round(ageMs / 60000);
  const limitMin = Math.round((intervalMs * 2) / 60000);
  if (ageMs > intervalMs * 2) {
    return { label: 'Heartbeat', status: 'warn', detail: `stale — ${ageMin} min ago (limit: ${limitMin} min)` };
  }
  return { label: 'Heartbeat', status: 'ok', detail: `${ageMin} min ago` };
}

function checkExportPath(): CheckResult {
  const cfg = vscode.workspace.getConfiguration('wildwest');
  const home = process.env['HOME'] ?? '~';
  const worldRoot = (cfg.get<string>('worldRoot') ?? '~/wildwest').replace(/^~/, home);
  const sessionsDir = cfg.get<string>('sessionsDir') ?? 'sessions';
  const exportPath = path.join(worldRoot, sessionsDir);
  if (!fs.existsSync(exportPath)) {
    return { label: 'Export path', status: 'warn', detail: `${exportPath} — does not exist` };
  }
  try {
    fs.accessSync(exportPath, fs.constants.W_OK);
  } catch {
    return { label: 'Export path', status: 'fail', detail: `${exportPath} — not writable` };
  }
  return { label: 'Export path', status: 'ok', detail: exportPath };
}

async function checkHookPort(): Promise<CheckResult> {
  const reachable = await portReachable(7379, '127.0.0.1', 500);
  return {
    label: 'Hook port 7379',
    status: reachable ? 'ok' : 'info',
    detail: reachable ? 'AIToolBridge listening' : 'not listening (AIToolBridge inactive)',
  };
}

function checkMCP(): CheckResult {
  const enabled = vscode.workspace.getConfiguration('wildwest').get<boolean>('mcp.enabled', false);
  return {
    label: 'MCP server',
    status: 'info',
    detail: enabled ? 'enabled (stdio)' : 'disabled (wildwest.mcp.enabled = false)',
  };
}

function checkConsent(context: vscode.ExtensionContext): CheckResult {
  const consented = context.globalState.get<boolean>('wildwest.sessionScanConsented', false);
  return {
    label: 'Session export consent',
    status: consented ? 'ok' : 'warn',
    detail: consented ? 'granted' : 'not granted — session export is dormant',
  };
}

function checkInbox(wwDir: string): CheckResult {
  const flatDir = path.join(wwDir, 'telegraph', 'flat');
  if (!fs.existsSync(flatDir)) {
    return { label: 'Wire cache', status: 'info', detail: 'flat/ does not exist' };
  }
  const wires = fs.readdirSync(flatDir).filter(
    (f) => (f.endsWith('.json') || f.endsWith('.md')) && !f.startsWith('.') && !f.startsWith('!'),
  );
  if (wires.length === 0) {
    return { label: 'Wire cache', status: 'ok', detail: 'empty' };
  }
  return {
    label: 'Wire cache',
    status: 'warn',
    detail: `${wires.length} wire${wires.length > 1 ? 's' : ''} in flat/`,
  };
}

function checkIdentityRole(wwDir: string, monitor: HeartbeatMonitor): CheckResult {
  const identity = vscode.workspace.getConfiguration('wildwest').get<string>('identity', '');
  if (!identity) {
    return { label: 'Identity', status: 'info', detail: 'not declared (wildwest.identity)' };
  }
  const scope = monitor.detectScope();
  if (!scope) {
    return { label: 'Identity', status: 'info', detail: `${identity} — scope not detected` };
  }
  const valid = monitor.validateIdentityForScope(identity, scope);
  return {
    label: 'Identity',
    status: valid ? 'ok' : 'warn',
    detail: valid ? `${identity} valid for ${scope}` : `${identity} is not a known role for ${scope}`,
  };
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export async function runDoctor(
  context: vscode.ExtensionContext,
  outputChannel: vscode.OutputChannel,
  monitor: HeartbeatMonitor,
): Promise<void> {
  outputChannel.show(true);
  outputChannel.appendLine('');
  outputChannel.appendLine('Wild West Doctor');
  outputChannel.appendLine('════════════════');

  const wwDir = findWwDir();
  if (!wwDir) {
    outputChannel.appendLine('❌ No .wildwest/ directory found in workspace root.');
    outputChannel.appendLine('   Run "Wild West: Init Town" to scaffold one.');
    vscode.window.showWarningMessage('Wild West Doctor: no .wildwest/ found in workspace.');
    return;
  }

  const cfg = vscode.workspace.getConfiguration('wildwest');
  const intervalMs = cfg.get<number>('heartbeat.town.intervalMs', 300_000);

  const syncChecks: CheckResult[] = [
    checkRegistry(wwDir),
    checkTelegraphDirs(wwDir),
    checkHeartbeat(wwDir, intervalMs),
    checkExportPath(),
    checkMCP(),
    checkConsent(context),
    checkInbox(wwDir),
    checkIdentityRole(wwDir, monitor),
  ];

  const hookCheck = await checkHookPort();
  const allChecks = [...syncChecks, hookCheck];

  const labelWidth = Math.max(...allChecks.map((c) => c.label.length)) + 2;
  for (const c of allChecks) {
    const padded = c.label.padEnd(labelWidth);
    outputChannel.appendLine(`${ICON[c.status]} ${padded}${c.detail}`);
  }

  outputChannel.appendLine('');

  const fails = allChecks.filter((c) => c.status === 'fail').length;
  const warns = allChecks.filter((c) => c.status === 'warn').length;
  if (fails > 0) {
    outputChannel.appendLine(`Doctor complete — ${fails} failure(s), ${warns} warning(s).`);
    vscode.window.showErrorMessage(`Wild West Doctor: ${fails} failure(s), ${warns} warning(s). See output.`);
  } else if (warns > 0) {
    outputChannel.appendLine(`Doctor complete — ${warns} warning(s).`);
    vscode.window.showWarningMessage(`Wild West Doctor: ${warns} warning(s). See output.`);
  } else {
    outputChannel.appendLine('Doctor complete — all checks passed ✅');
    vscode.window.showInformationMessage('Wild West Doctor: all checks passed ✅');
  }
}
