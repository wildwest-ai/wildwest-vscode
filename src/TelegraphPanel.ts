import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import {
  FlatWire,
  WireTransitionContext,
  applyStatusUpdate,
  createFlatWire,
  createWireStatusUpdatePacket,
  writeDraftWire,
  writeWireUpdatePacket,
  parseFilenameActors,
} from './WireFactory';
import { readRegistryAlias } from './TelegraphService';
import { PromptIndexService } from './PromptIndexService';
import type { HeartbeatMonitor } from './HeartbeatMonitor';

/** New protocol: wire files are always {wwuid}.json */
const UUID_FILE_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.json$/;

export function addressMatchesActor(field: string, alias: string, identity: string): boolean {
  if (!field) return false;
  const f = field.toLowerCase();
  const a = alias.toLowerCase();
  const id = identity.toLowerCase();

  // Exact identity or with .Channel suffix: "CD(RSn)" or "CD(RSn).Cld"
  if (id && (f === id || f.startsWith(id + '.'))) return true;

  if (a) {
    // Alias in parens: TM(wildwest-vscode) [legacy]
    if (f.includes('(' + a + ')')) return true;
    // Alias in brackets: TM[wildwest-vscode] or TM(RHk)[wildwest-vscode]
    if (f.includes('[' + a + ']')) return true;
    // Glob in parens: TM(*vscode) — alias ends with suffix
    const glob = f.match(/\(\*([^)]+)\)/);
    if (glob && a.endsWith(glob[1])) return true;
    // Glob in brackets: TM[*vscode]
    const globB = f.match(/\[\*([^\]]+)\]/);
    if (globB && a.endsWith(globB[1])) return true;
    // Bare alias as whole field
    if (f === a) return true;
  }

  return false;
}

export class TelegraphPanel {
  static readonly viewType = 'wildwest.telegraphPanel';
  private static instance: TelegraphPanel | undefined;

  private readonly panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];
  private static outputChannel = vscode.window.createOutputChannel('Wild West Telegraph');

  static open(exportPath: string, promptIndex?: PromptIndexService, heartbeat?: HeartbeatMonitor): void {
    if (TelegraphPanel.instance) {
      TelegraphPanel.instance.panel.reveal();
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      TelegraphPanel.viewType,
      'Telegraph',
      vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    TelegraphPanel.instance = new TelegraphPanel(panel, promptIndex, heartbeat);
  }

  private constructor(
    panel: vscode.WebviewPanel,
    private readonly promptIndex?: PromptIndexService,
    private readonly heartbeat?: HeartbeatMonitor,
  ) {
    this.panel = panel;
    this.panel.webview.html = this.buildHtml();
    this.sendWires();

    this.panel.webview.onDidReceiveMessage((msg) => this.onMessage(msg), null, this.disposables);
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
  }

  // ── Flat directory resolution ─────────────────────────────────────────────

  private getFlatDir(): string | null {
    const cfg = vscode.workspace.getConfiguration('wildwest');
    const home = process.env['HOME'] ?? '~';
    const worldRoot = (cfg.get<string>('worldRoot') ?? '~/wildwest').replace(/^~/, home);
    const flatDir = path.join(worldRoot, 'telegraph', 'flat');
    return fs.existsSync(flatDir) ? flatDir : null;
  }

  /**
   * Returns the workspace-local flat/ directory.
   * This is the town's local cache — heartbeat syncs from territory SSOT into here.
   * Panel reads from this directory only; never directly from territory SSOT.
   */
  private getWorkspaceFlatDir(): string | null {
    const wsPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
    if (!wsPath) return null;
    const dir = path.join(wsPath, '.wildwest', 'telegraph', 'flat');
    // Return path even if it doesn't exist yet — createFlatWire will create it
    return dir;
  }

  private readRegistryScope(rootPath: string): string | null {
    try {
      const reg = JSON.parse(
        fs.readFileSync(path.join(rootPath, '.wildwest', 'registry.json'), 'utf8'),
      ) as Record<string, unknown>;
      const scope = reg['scope'];
      return typeof scope === 'string' ? scope : null;
    } catch {
      return null;
    }
  }

  private findAncestorScopeRoot(startPath: string, scope: string): string | null {
    let current = startPath;
    const fsRoot = path.parse(current).root;
    while (current && current !== fsRoot) {
      if (this.readRegistryScope(current) === scope) return current;
      current = path.dirname(current);
    }
    return null;
  }

  private getScopeRootsForOutboxRecovery(): string[] {
    const roots = new Set<string>();
    const folders = vscode.workspace.workspaceFolders ?? [];
    for (const folder of folders) {
      const wsPath = folder.uri.fsPath;
      if (fs.existsSync(path.join(wsPath, '.wildwest', 'registry.json'))) {
        roots.add(wsPath);
      }
      const countyRoot = this.findAncestorScopeRoot(wsPath, 'county');
      if (countyRoot) roots.add(countyRoot);
    }
    return [...roots];
  }

  private getActorAlias(): string {
    const wsPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
    return readRegistryAlias(path.join(wsPath, '.wildwest')) ?? '';
  }

  private getWireTransitionContext(source: string): WireTransitionContext {
    const wsPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
    const identity = vscode.workspace.getConfiguration('wildwest').get<string>('identity') ?? '';
    try {
      const reg = JSON.parse(
        fs.readFileSync(path.join(wsPath, '.wildwest', 'registry.json'), 'utf8'),
      ) as Record<string, unknown>;
      return {
        by: identity || undefined,
        scope: (reg['scope'] as string | undefined) ?? undefined,
        alias: (reg['alias'] as string | undefined) ?? undefined,
        tool: 'vscode',
        source,
      };
    } catch {
      return { by: identity || undefined, tool: 'vscode', source };
    }
  }

  /**
   * True if a `to`/`from` address field belongs to this actor.
   */
  private addressMatchesSelf(field: string, alias: string, identity: string): boolean {
    return addressMatchesActor(field, alias, identity);
  }

  // ── Read flat/ wires ──────────────────────────────────────────────────────

  /**
   * Read all wires for panel display.
   * - Territory flat/ (~/wildwest/telegraph/flat/) is the SSOT.
   * - Local .wildwest/telegraph/flat/ is this scope's cache.
   * - Heartbeat syncs territory → local cache; the panel reads local cache only.
   */
  /**
   * Find the actual file path for a wire by wwuid in a given directory.
   * New protocol: wire files are always named {wwuid}.json.
   */
  private findWireFilePath(wwuid: string, dir: string): string | null {
    const p = path.join(dir, `${wwuid}.json`);
    return fs.existsSync(p) ? p : null;
  }

  private readAllFlatWires(): FlatWire[] {
    // Panel reads local cache only (.wildwest/telegraph/flat/).
    // Heartbeat syncs territory SSOT → local cache on every beat and after delivery.
    // Draft/pending wires also live in local cache until promoted.
    const wsDir = this.getWorkspaceFlatDir();
    if (!wsDir) return [];

    const byWwuid = new Map<string, FlatWire>();
    let entries: string[];
    try { entries = fs.readdirSync(wsDir); } catch { return []; }

    for (const f of entries) {
      if (!f.endsWith('.json') || f.startsWith('.') || !UUID_FILE_RE.test(f)) continue;
      try {
        const wire = JSON.parse(fs.readFileSync(path.join(wsDir, f), 'utf8')) as FlatWire;
        if (!wire.from || !wire.to) {
          const parsed = parseFilenameActors(wire.filename);
          if (!wire.from && parsed.from) wire.from = parsed.from;
          if (!wire.to && parsed.to) wire.to = parsed.to;
        }
        const key = wire.wwuid ?? f.replace('.json', '');
        byWwuid.set(key, wire);
      } catch { /* skip corrupt */ }
    }

    return [...byWwuid.values()].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }

  private readFailedOutboxWires(): FlatWire[] {
    const byWwuid = new Map<string, FlatWire>();
    for (const rootPath of this.getScopeRootsForOutboxRecovery()) {
      const outboxDir = path.join(rootPath, '.wildwest', 'telegraph', 'outbox');
      let entries: string[];
      try { entries = fs.readdirSync(outboxDir); } catch { continue; }
      for (const f of entries) {
        if (!f.startsWith('!') || !UUID_FILE_RE.test(f.slice(1))) continue;
        try {
          const filePath = path.join(outboxDir, f);
          const wire = JSON.parse(fs.readFileSync(filePath, 'utf8')) as FlatWire & Record<string, unknown>;
          wire.status = 'failed';
          wire['_failedFile'] = filePath;
          wire['_outboxRoot'] = rootPath;
          const key = wire.wwuid ?? f.slice(1).replace('.json', '');
          byWwuid.set(key, wire);
        } catch { /* skip corrupt */ }
      }
    }
    return [...byWwuid.values()].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }

  private filterWires(all: FlatWire[], alias: string, identity: string): { inbox: FlatWire[]; outbox: FlatWire[] } {
    if (!alias && !identity) return { inbox: [], outbox: [] };
    return {
      inbox:  all.filter((w) => this.addressMatchesSelf(w.to   ?? '', alias, identity)),
      outbox: all.filter((w) => this.addressMatchesSelf(w.from ?? '', alias, identity)),
    };
  }

  // ── Outbound to webview ───────────────────────────────────────────────────

  private sendWires(): void {
    const all = [...this.readAllFlatWires(), ...this.readFailedOutboxWires()];
    const alias = this.getActorAlias();
    const identity = vscode.workspace.getConfiguration('wildwest').get<string>('identity') ?? '';
    const { inbox, outbox } = this.filterWires(all, alias, identity);
    const flatAvailable = true; // local cache always available (created on first send)
    this.panel.webview.postMessage({ type: 'wires', inbox, outbox, all, alias, flatAvailable });
  }

  static refresh(): void {
    TelegraphPanel.instance?.sendWires();
  }

  // ── Inbound from webview ──────────────────────────────────────────────────

  private log(msg: string): void {
    TelegraphPanel.outputChannel.appendLine(`[TelegraphPanel ${new Date().toISOString()}] ${msg}`);
  }

  private async onMessage(msg: Record<string, unknown>): Promise<void> {
    this.log(`onMessage: type=${msg['type']} wwuid=${msg['wwuid'] ?? ''} wwuids=${JSON.stringify(msg['wwuids'] ?? '')} status=${msg['status'] ?? ''}`);
    switch (msg['type']) {
      case 'refresh':
        this.sendWires();
        break;
      case 'send':
        await this.handleSend(msg);
        break;
      case 'pushToCopilot':
        await this.pushToCopilot(msg['formatted'] as string);
        break;
      case 'pushToTerminal':
        await this.pushToTerminal(msg['formatted'] as string, msg['label'] as string);
        break;
      case 'archive':
        this.handleArchiveWire(msg['wwuid'] as string, (msg['perspective'] as 'recipient' | 'sender') ?? 'recipient');
        break;
      case 'markRead':
        this.handleMarkRead(msg['wwuid'] as string);
        break;
      case 'sendDraft':
        this.handleSendDraft(msg['wwuid'] as string);
        break;
      case 'retryWire':
        this.handleRetryWire(msg['wwuid'] as string);
        break;
      case 'bulkStatus': {
        const wwuids = msg['wwuids'] as string[];
        const status = msg['status'] as string;
        const perspective = (msg['perspective'] as 'recipient' | 'sender') ?? 'recipient';
        this.handleBulkStatus(wwuids, status, perspective);
        break;
      }
      case 'promptSearch': {
        const query = (msg['query'] as string) ?? '';
        const results = this.promptIndex?.search(query, undefined, 10, {
          excludeKinds: ['terminal_output', 'authorization', 'continuation'],
          includeGlobalFallback: false,
          includeScopeLineage: true,
        }) ?? [];
        this.panel.webview.postMessage({ type: 'promptResults', results });
        break;
      }
    }
  }

  private async handleSend(msg: Record<string, unknown>): Promise<void> {
    const to = (msg['to'] as string ?? '').trim();
    const type = (msg['wireType'] as string ?? 'status-update').trim();
    const subject = (msg['subject'] as string ?? '').trim();
    const body = (msg['body'] as string ?? '').trim();

    if (!to || !subject || !body) {
      this.panel.webview.postMessage({ type: 'error', text: 'To, subject, and body are required.' });
      return;
    }

    const wsPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
    const alias = readRegistryAlias(path.join(wsPath, '.wildwest'));
    const identity = vscode.workspace.getConfiguration('wildwest').get<string>('identity') ?? '';
    const roleMatch = identity.match(/^([A-Za-z]+)/);
    const role = roleMatch?.[1] ?? 'TM';
    const fromActor = alias ? `${role}[${alias}]` : (identity || 'TM');

    const transitionContext = this.getWireTransitionContext('telegraph-panel.compose');
    const wire = createFlatWire({ from: fromActor, to, type, subject, body, status: 'pending', transitionContext });

    // Write to local outbox for heartbeat pickup → heartbeat promotes to SSOT.
    // Call deliverOutboxNow() immediately so there's no waiting for the next tick.
    const outboxDir = path.join(wsPath, '.wildwest', 'telegraph', 'outbox');
    fs.mkdirSync(outboxDir, { recursive: true });
    fs.writeFileSync(path.join(outboxDir, `${wire.wwuid}.json`), JSON.stringify(wire, null, 2), 'utf8');

    // Also save to local flat/ so it shows in Outbox > Pending while delivery runs
    writeDraftWire(wire, wsPath);

    this.panel.webview.postMessage({ type: 'sent', wire });
    this.heartbeat?.deliverOutboxNow();
    this.sendWires();
  }

  private handleBulkStatus(wwuids: string[], status: string, perspective: 'recipient' | 'sender' = 'recipient'): void {
    const flatDir = this.getFlatDir();
    const wsDir = this.getWorkspaceFlatDir();
    this.log(`handleBulkStatus: wwuids=${JSON.stringify(wwuids)} status=${status} flatDir=${flatDir} wsDir=${wsDir}`);
    if (!wwuids?.length || !status) { this.log('handleBulkStatus: early exit — no wwuids or status'); return; }
    // Archive uses overlay pattern — delegate to handleArchiveWire per wire
    if (status === 'archived') {
      for (const wwuid of wwuids) this.handleArchiveWire(wwuid, perspective);
      return; // sendWires called inside handleArchiveWire
    }
    if (status === 'read') {
      for (const wwuid of wwuids) this.handleMarkRead(wwuid);
      return; // sendWires called inside handleMarkRead
    }
    const isoNow = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
    const transitionContext = this.getWireTransitionContext('telegraph-panel.bulk-status');
    for (const wwuid of wwuids) {
      // Prefer territory for sent/received/read; fall back to local for draft/pending
      const dirs = flatDir ? [flatDir] : [];
      if (wsDir) dirs.push(wsDir);
      for (const dir of dirs) {
        const filePath = this.findWireFilePath(wwuid, dir);
        if (!filePath) continue;
        try {
          const wire = JSON.parse(fs.readFileSync(filePath, 'utf8')) as FlatWire;
          const patch = { status };
          const transition = applyStatusUpdate(wire, status, patch, transitionContext, isoNow);
          fs.writeFileSync(filePath, JSON.stringify(wire, null, 2), 'utf8');
          writeWireUpdatePacket(createWireStatusUpdatePacket(wire, patch, transition, transitionContext), dir);
        } catch { /* skip */ }
        break; // only write to first dir that has the file
      }
    }
    this.sendWires();
  }

  private handleSendDraft(wwuid: string): void {
    // Draft lives in local flat/; promote to pending and move to outbox for heartbeat pickup.
    // Call deliverOutboxNow() immediately so there's no waiting for the next tick.
    const wsPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
    const localFlatDir = path.join(wsPath, '.wildwest', 'telegraph', 'flat');
    const localFilePath = path.join(localFlatDir, `${wwuid}.json`);
    if (!wwuid || !fs.existsSync(localFilePath)) return;
    try {
      const wire = JSON.parse(fs.readFileSync(localFilePath, 'utf8')) as FlatWire;
      const isoNow = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
      const transitionContext = this.getWireTransitionContext('telegraph-panel.send-draft');
      const patch = { status: 'pending' };
      const transition = applyStatusUpdate(wire, 'pending', patch, transitionContext, isoNow);
      // Update local flat/ so Outbox shows Pending while delivery runs
      fs.writeFileSync(localFilePath, JSON.stringify(wire, null, 2), 'utf8');
      writeWireUpdatePacket(createWireStatusUpdatePacket(wire, patch, transition, transitionContext), localFlatDir);
      // Drop in workspace outbox/ for heartbeat pickup
      const outboxDir = path.join(wsPath, '.wildwest', 'telegraph', 'outbox');
      fs.mkdirSync(outboxDir, { recursive: true });
      fs.writeFileSync(path.join(outboxDir, `${wire.wwuid}.json`), JSON.stringify(wire, null, 2), 'utf8');
      this.heartbeat?.deliverOutboxNow();
      this.sendWires();
    } catch (err) {
      vscode.window.showErrorMessage(`Wild West: send draft failed — ${err}`);
    }
  }

  private handleRetryWire(wwuid: string): void {
    if (!wwuid) return;
    for (const rootPath of this.getScopeRootsForOutboxRecovery()) {
      const outboxDir = path.join(rootPath, '.wildwest', 'telegraph', 'outbox');
      const failedPath = path.join(outboxDir, `!${wwuid}.json`);
      const restoredPath = path.join(outboxDir, `${wwuid}.json`);
      if (!fs.existsSync(failedPath)) continue;
      try {
        const wire = JSON.parse(fs.readFileSync(failedPath, 'utf8')) as FlatWire & Record<string, unknown>;
        for (const key of ['to', 'from', 'subject', 'type']) {
          if (typeof wire[key] === 'string') {
            wire[key] = (wire[key] as string).replace(/\(!\)$/u, '');
          }
        }
        wire.status = 'pending';
        delete wire['failure'];
        delete wire['failed_at'];
        const transitionContext = this.getWireTransitionContext('telegraph-panel.retry-wire');
        const isoNow = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
        applyStatusUpdate(wire, 'pending', { status: 'pending' }, transitionContext, isoNow);
        fs.writeFileSync(restoredPath, JSON.stringify(wire, null, 2), 'utf8');
        fs.unlinkSync(failedPath);

        const localFlatDir = path.join(rootPath, '.wildwest', 'telegraph', 'flat');
        fs.mkdirSync(localFlatDir, { recursive: true });
        fs.writeFileSync(path.join(localFlatDir, `${wwuid}.json`), JSON.stringify(wire, null, 2), 'utf8');

        this.heartbeat?.deliverOutboxNow();
        this.sendWires();
        return;
      } catch (err) {
        vscode.window.showErrorMessage(`Wild West: retry failed — ${err}`);
        return;
      }
    }
    vscode.window.showWarningMessage(`Wild West: failed wire not found — ${wwuid}`);
  }

  private handleMarkRead(wwuid: string): void {
    const flatDir = this.getFlatDir();
    const wsDir = this.getWorkspaceFlatDir();
    this.log(`handleMarkRead: wwuid=${wwuid} flatDir=${flatDir} wsDir=${wsDir}`);
    if (!wwuid) { this.log('handleMarkRead: early exit — no wwuid'); return; }

    const territoryPath = flatDir ? this.findWireFilePath(wwuid, flatDir) : null;
    const localPath = wsDir ? path.join(wsDir, `${wwuid}.json`) : null;
    const sourcePath = territoryPath ?? (wsDir ? this.findWireFilePath(wwuid, wsDir) : null);
    this.log(`handleMarkRead: territoryPath=${territoryPath ?? 'not found'} localPath=${localPath ?? 'none'} sourcePath=${sourcePath ?? 'not found'}`);
    if (!sourcePath) {
      this.log(`handleMarkRead: no file found for wwuid=${wwuid}`);
      return;
    }

    const isoNow = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
    try {
      const wire = JSON.parse(fs.readFileSync(sourcePath, 'utf8')) as FlatWire;
      const transitionContext = this.getWireTransitionContext('telegraph-panel.mark-read');
      const patch: Record<string, unknown> = { status: 'read', read_at: isoNow };
      let transition = wire.status_transitions?.find((t) => t.status === 'read');
      if (wire.status !== 'read') {
        transition = applyStatusUpdate(wire, 'read', patch, transitionContext, isoNow);
      }

      if (territoryPath) {
        fs.writeFileSync(territoryPath, JSON.stringify(wire, null, 2), 'utf8');
        if (transition) {
          writeWireUpdatePacket(createWireStatusUpdatePacket(wire, patch, transition, transitionContext), flatDir!);
        }
        this.log(`handleMarkRead: wrote read status to territory ${territoryPath}`);
      }

      if (localPath) {
        fs.mkdirSync(path.dirname(localPath), { recursive: true });
        const localWire = fs.existsSync(localPath)
          ? { ...wire, ...JSON.parse(fs.readFileSync(localPath, 'utf8')) as Record<string, unknown> }
          : wire;
        localWire['status'] = wire.status;
        localWire['read_at'] = wire.read_at;
        localWire['status_transitions'] = wire.status_transitions;
        fs.writeFileSync(localPath, JSON.stringify(localWire, null, 2), 'utf8');
        if (transition) {
          writeWireUpdatePacket(createWireStatusUpdatePacket(wire, patch, transition, transitionContext), path.dirname(localPath));
        }
        this.log(`handleMarkRead: wrote read status to local cache ${localPath}`);
      }

      this.sendWires();
    } catch (err) {
      this.log(`handleMarkRead: error ${err}`);
    }
  }

  private handleArchiveWire(wwuid: string, perspective: 'recipient' | 'sender' = 'recipient'): void {
    const flatDir = this.getFlatDir();
    const wsDir = this.getWorkspaceFlatDir();
    this.log(`handleArchiveWire: wwuid=${wwuid} flatDir=${flatDir} wsDir=${wsDir}`);
    if (!wwuid) { this.log('handleArchiveWire: early exit — no wwuid'); return; }
    const alias = this.getActorAlias();
    const identity = vscode.workspace.getConfiguration('wildwest').get<string>('identity') ?? '';
    this.log(`handleArchiveWire: alias=${alias} identity=${identity}`);
    const isoNow = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

    // Archive is a local per-actor view action — writes overlay field to local copy only.
    // Does NOT write to territory SSOT (so the other party's view is unaffected).
    const localDir = wsDir ?? (flatDir ? path.join(
      vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '', '.wildwest', 'telegraph', 'flat'
    ) : null);
    if (!localDir) {
      this.log(`handleArchiveWire: ERROR — no local or territory dir found`);
      console.error('Wild West: handleArchiveWire — no local or territory dir found', wwuid);
      return;
    }

    // Determine which overlay field to set based on sender vs recipient
    // Use findWireFilePath to handle both UUID-named and legacy timestamp-named files
    const sourcePath = this.findWireFilePath(wwuid, localDir)
      ?? (flatDir ? this.findWireFilePath(wwuid, flatDir) : null);
    const localPath = path.join(localDir, `${wwuid}.json`);
    this.log(`handleArchiveWire: localDir=${localDir} sourcePath=${sourcePath}`);
    if (!sourcePath) {
      this.log(`handleArchiveWire: ERROR — wire not found in local or territory`);
      console.error('Wild West: handleArchiveWire — wire not found in local or territory', { wwuid, localDir, flatDir });
      return;
    }

    try {
      const wire = JSON.parse(fs.readFileSync(sourcePath, 'utf8')) as FlatWire;
      const overlayField = perspective === 'recipient' ? 'recipient_archived_at' : 'sender_archived_at';
      this.log(`handleArchiveWire: wire.from=${wire.from} wire.to=${wire.to} perspective=${perspective} overlayField=${overlayField}`);

      // Write overlay to local flat/ (not territory)
      fs.mkdirSync(localDir, { recursive: true });
      const localWire = fs.existsSync(localPath)
        ? JSON.parse(fs.readFileSync(localPath, 'utf8')) as Record<string, unknown>
        : { ...wire } as Record<string, unknown>;
      localWire[overlayField] = isoNow;
      fs.writeFileSync(localPath, JSON.stringify(localWire, null, 2), 'utf8');
      console.log('Wild West: archived wire locally', { wwuid, perspective, overlayField, path: localPath });

      // If both parties have now archived (overlay fields both set), promote territory to archived
      const bothArchived =
        localWire['sender_archived_at'] && localWire['recipient_archived_at'];
      const territoryFilePath = flatDir ? this.findWireFilePath(wwuid, flatDir) : null;
      if (bothArchived && territoryFilePath) {
        try {
          const tw = JSON.parse(fs.readFileSync(territoryFilePath, 'utf8')) as FlatWire;
          const transitionContext = this.getWireTransitionContext('telegraph-panel.archive');
          const patch = {
            status: 'archived',
            sender_archived_at: localWire['sender_archived_at'],
            recipient_archived_at: localWire['recipient_archived_at'],
          };
          const transition = applyStatusUpdate(tw, 'archived', patch, transitionContext, isoNow);
          fs.writeFileSync(territoryFilePath, JSON.stringify(tw, null, 2), 'utf8');
          writeWireUpdatePacket(createWireStatusUpdatePacket(tw, patch, transition, transitionContext), flatDir!);
          this.log(`handleArchiveWire: promoted archive to territory ${territoryFilePath}`);
        } catch (err) { console.error('Wild West: territory promotion failed', err); }
      }

      this.sendWires();
    } catch (err) {
      console.error('Wild West: handleArchiveWire error', err);
    }
  }

  private async pushToCopilot(formatted: string): Promise<void> {
    try {
      await vscode.commands.executeCommand('workbench.action.chat.open', { query: formatted });
    } catch {
      await vscode.env.clipboard.writeText(formatted);
      vscode.window.showInformationMessage('Copied to clipboard — paste into Copilot chat.');
    }
  }

  private async pushToTerminal(formatted: string, label: string): Promise<void> {
    const terminals = vscode.window.terminals;
    if (terminals.length === 0) {
      await vscode.env.clipboard.writeText(formatted);
      vscode.window.showInformationMessage('No terminals open — copied to clipboard.');
      return;
    }

    const keyword = label.toLowerCase();
    const sorted = [...terminals].sort((a, b) => {
      const aMatch = a.name.toLowerCase().includes(keyword) ? -1 : 1;
      const bMatch = b.name.toLowerCase().includes(keyword) ? -1 : 1;
      return aMatch - bMatch;
    });

    let target: vscode.Terminal;
    if (sorted.length === 1) {
      target = sorted[0];
    } else {
      const pick = await vscode.window.showQuickPick(
        sorted.map((t) => ({ label: t.name, terminal: t })),
        { placeHolder: `Select terminal to send to ${label}` },
      );
      if (!pick) return;
      target = pick.terminal;
    }

    target.show();
    await vscode.commands.executeCommand('workbench.action.terminal.sendSequence', {
      text: formatted,
    });
  }

  // ── HTML ──────────────────────────────────────────────────────────────────

  private buildHtml(): string {
    // try to reference the repo media via webview.asWebviewUri (preferred)
    let iconMarkup = '';
    try {
      const mediaRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
      const iconPath = path.join(mediaRoot, 'media', 'telegraph.svg');
      if (fs.existsSync(iconPath)) {
        // external URI for webview
        const uri = this.panel.webview.asWebviewUri(vscode.Uri.file(iconPath));
        iconMarkup = `<img src="${uri.toString()}" class="svg-external" aria-hidden="true" />`;
        // also attempt to inline as a robust fallback for theming if reading succeeds
        try { iconMarkup = fs.readFileSync(iconPath, 'utf8'); } catch { /* keep external img */ }
      }
    } catch {
      iconMarkup = '';
    }

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Telegraph</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); background: var(--vscode-editor-background); display: flex; flex-direction: column; height: 100vh; overflow: hidden; }

  /* ── Header ── */
  .header { display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; border-bottom: 1px solid var(--vscode-panel-border); flex-shrink: 0; }
  .header h2 { font-size: 13px; font-weight: 600; }
  .title { display:flex; align-items:center; gap:8px; }
  .title .icon svg { width:18px; height:18px; fill:currentColor; display:block; }
  .btn { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 4px 10px; border-radius: 3px; cursor: pointer; font-size: 12px; }
  .btn:hover { background: var(--vscode-button-hoverBackground); }
  .btn-secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  .btn-secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }

  /* ── Tabs ── */
  .tabs { display: flex; border-bottom: 1px solid var(--vscode-panel-border); flex-shrink: 0; }
  .tab { padding: 6px 14px; font-size: 12px; cursor: pointer; border-bottom: 2px solid transparent; color: var(--vscode-descriptionForeground); user-select: none; }
  .tab:hover { color: var(--vscode-foreground); }
  .tab.active { color: var(--vscode-foreground); border-bottom-color: var(--vscode-focusBorder); }
  .tab .badge { display: inline-block; background: transparent; color: var(--vscode-descriptionForeground); font-size: 10px; border-radius: 6px; padding: 0 3px; margin-left: 4px; }

  /* ── Search (All tab) ── */
  .search-bar { padding: 6px 10px; border-bottom: 1px solid var(--vscode-panel-border); flex-shrink: 0; display: none; }
  .search-bar.visible { display: block; }
  .search-bar input { width: 100%; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, #555); padding: 3px 6px; font-size: 12px; border-radius: 2px; }

  /* ── Main layout ── */
  .main { display: flex; flex: 1; overflow: hidden; }

  /* draggable divider between list and detail */
  .divider { width: 6px; cursor: col-resize; background: transparent; flex-shrink: 0; }
  .divider:hover { background: rgba(128,128,128,0.06); }

  /* ── Wire list ── */
  .list-pane { width: 240px; flex-shrink: 0; border-right: 1px solid var(--vscode-panel-border); overflow-y: auto; display: flex; flex-direction: column; }
  .wire-row { border-left: 3px solid transparent; }
  .wire-row:hover { background: var(--vscode-list-hoverBackground); }
  .wire-row.active { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); border-left-color: var(--vscode-focusBorder); }
  .wire-row .subject { font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .wire-row .meta { font-size: 10px; color: var(--vscode-descriptionForeground); margin-top: 2px; display: flex; gap: 4px; align-items: center; }
  .wire-row.active .meta { color: var(--vscode-list-activeSelectionForeground); opacity: 0.8; }
  .empty-list { padding: 16px 10px; font-size: 12px; color: var(--vscode-descriptionForeground); text-align: center; }

  /* ── Status badges ── */
  .badge-status { font-size: 9px; padding: 1px 4px; border-radius: 3px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; }
  .badge-sent { background: #00407a; color: #80cfff; }
  .badge-received { background: #6b6b00; color: #ffff80; }
  .badge-read { background: #1a4a1a; color: #80ff80; }
  .badge-delivered { background: #003d6b; color: #80cfff; }
  .badge-failed { background: #5a1d1d; color: #ffb3b3; }
  .badge-archived { background: #333; color: #aaa; }

  /* ── Wire detail ── */
  .detail-pane { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 12px; }
  .detail-pane.empty-detail { align-items: center; justify-content: center; color: var(--vscode-descriptionForeground); font-size: 12px; }
  .wire-meta-table { width: 100%; border-collapse: collapse; font-size: 12px; }
  .wire-meta-table td { padding: 3px 8px; vertical-align: top; }
  .wire-meta-table td:first-child { font-weight: 600; color: var(--vscode-descriptionForeground); width: 80px; white-space: nowrap; }
  .wire-body { font-size: 13px; line-height: 1.6; white-space: pre-wrap; word-break: break-word; padding: 10px; background: var(--vscode-textBlockQuote-background, var(--vscode-editor-inactiveSelectionBackground)); border-radius: 3px; border-left: 3px solid var(--vscode-panel-border); }
  .wire-body.empty { color: var(--vscode-descriptionForeground); font-style: italic; }
  .timeline { font-size: 11px; color: var(--vscode-descriptionForeground); }
  .timeline-item { display: flex; gap: 8px; align-items: baseline; padding: 2px 0; }
  .timeline-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--vscode-focusBorder); flex-shrink: 0; margin-top: 4px; }
  .push-bar { display: flex; gap: 8px; flex-wrap: wrap; }
  .push-bar .btn { font-size: 11px; padding: 3px 8px; }
  .section-label { font-size: 11px; font-weight: 600; color: var(--vscode-descriptionForeground); text-transform: uppercase; letter-spacing: 0.05em; }

  /* ── Status filter bar ── */
  .status-filter { display: none; gap: 0px; padding: 5px 10px; border-bottom: 1px solid var(--vscode-panel-border); flex-shrink: 0; }
  .status-filter.visible { display: flex; }
  /* chips: compact, no rounded outline; active state shows a horizontal bottom bar like tabs */
  .sf-btn { background: transparent; border: none; color: var(--vscode-descriptionForeground); font-size: 11px; padding: 6px 8px; border-radius: 0; cursor: pointer; display:flex; align-items:center; gap:4px; }
  .sf-btn:hover { color: var(--vscode-foreground); }
  .sf-btn.active { background: transparent; color: var(--vscode-foreground); border-bottom: 2px solid var(--vscode-focusBorder); padding-bottom: 4px; }
  .chip-checkbox { width:12px; height:12px; accent-color: var(--vscode-button-foreground); }
  .chip-label { font-size:11px; }
  .chip-count { display: inline-block; font-size: 10px; padding: 0; margin-left: 4px; border-radius: 6px; background: transparent; color: var(--vscode-descriptionForeground); }

  /* ── Scope section headers ── */
  .scope-header { font-size: 10px; font-weight: 700; color: var(--vscode-descriptionForeground); text-transform: uppercase; letter-spacing: 0.07em; padding: 8px 10px 3px; opacity: 0.6; }

  /* ── Bulk action bar ── */
  .bulk-bar { display: none; align-items: center; gap: 6px; padding: 4px 10px; border-bottom: 1px solid var(--vscode-panel-border); background: var(--vscode-editor-inactiveSelectionBackground); flex-shrink: 0; }
  .bulk-bar.visible { display: flex; }
  .bulk-select-all { font-size: 11px; display: flex; align-items: center; gap: 4px; white-space: nowrap; }
  .bulk-count { font-size: 11px; color: var(--vscode-descriptionForeground); flex: 1; }
  .bulk-select { background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, #555); font-size: 11px; padding: 2px 4px; border-radius: 2px; }

  /* ── Checkbox in wire rows ── */
  .wire-row { display: flex; align-items: flex-start; gap: 6px; padding: 7px 10px; cursor: pointer; border-left: 3px solid transparent; }
  .wire-check { margin-top: 2px; flex-shrink: 0; cursor: pointer; }
  .wire-content { flex: 1; min-width: 0; }

  /* ── Compose drawer ── */
  .compose-drawer { border-top: 1px solid var(--vscode-panel-border); flex-shrink: 0; overflow: hidden; transition: max-height 0.2s ease; max-height: 0; }
  .compose-drawer.open { max-height: 300px; }
  .compose-form { padding: 12px; display: flex; flex-direction: column; gap: 8px; }
  .compose-row { display: flex; gap: 8px; align-items: center; }
  .compose-row label { font-size: 11px; font-weight: 600; color: var(--vscode-descriptionForeground); width: 52px; flex-shrink: 0; }
  .compose-row input, .compose-row select { flex: 1; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, #555); padding: 3px 6px; font-size: 12px; border-radius: 2px; }
  .compose-body { background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, #555); padding: 6px; font-size: 12px; border-radius: 2px; resize: none; height: 70px; font-family: var(--vscode-font-family); width: 100%; }
  .compose-footer { display: flex; justify-content: flex-end; gap: 8px; }
  .error-bar { color: var(--vscode-errorForeground); font-size: 11px; padding: 2px 0; }
</style>
</head>
<body>

    <div class="header">
  <div class="title">
    <span class="icon" aria-hidden="true">
      ${iconMarkup}
    </span>
    <h2>Telegraph</h2>
  </div>
    <div style="display:flex;gap:6px;align-items:center">
      <button class="btn btn-secondary" id="btnRefresh">↻</button>
      <button class="btn" id="btnCompose">✎ Compose</button>
      <button class="btn" id="btnSettings" title="Settings">⚙︎</button>
      <div id="settingsMenu" style="display:none;position:relative">
        <div id="settingsPopover" role="dialog" aria-label="Telegraph settings" style="position:absolute;right:0;top:28px;background:var(--vscode-editor-background);border:1px solid var(--vscode-panel-border);padding:8px;border-radius:4px;box-shadow:0 6px 18px rgba(0,0,0,0.2);width:260px;z-index:200">
          <div style="font-size:12px;font-weight:600;margin-bottom:6px">Telegraph Settings</div>
          <label style="display:flex;align-items:center;gap:8px;font-size:12px"><input type="checkbox" id="hideZeroStatus"/> Hide Pending/Failed status chips when count is 0</label>
        </div>
      </div>
    </div>
</div>

<div class="tabs">
  <div class="tab active" data-tab="inbox">Inbox <span class="badge" id="badgeInbox">0</span></div>
  <div class="tab" data-tab="outbox">Outbox <span class="badge" id="badgeOutbox">0</span></div>
  <div class="tab" data-tab="all">All <span class="badge" id="badgeAll">0</span></div>
</div>

<div class="status-filter" id="statusFilter"></div>

<div class="bulk-bar" id="bulkBar">
  <label class="bulk-select-all"><input type="checkbox" id="selectAll"> All</label>
  <span id="selectedCount" class="bulk-count">0 selected</span>
  <select id="bulkStatus" class="bulk-select">
    <option value="">— set status —</option>
    <option value="draft">Draft</option>
    <option value="pending">Pending</option>
    <option value="sent">Sent</option>
    <option value="delivered">Delivered</option>
    <option value="archived">Archived</option>
  </select>
  <button class="btn" id="bulkApply">Apply</button>
  <button class="btn btn-secondary" id="bulkClear">✕</button>
</div>

<div class="search-bar" id="searchBar">
  <input id="searchInput" placeholder="Search wires…" autocomplete="off" />
</div>

<div class="main">
  <div class="list-pane" id="listPane"></div>
  <div class="divider" id="divider" role="separator" aria-orientation="vertical" tabindex="0"></div>
  <div class="detail-pane empty-detail" id="detailPane"></div>
</div>

<div class="compose-drawer" id="composeDrawer">
  <div class="compose-form">
    <div class="compose-row"><label for="cTo">To</label><input id="cTo" placeholder="CD(RSn)" /></div>
    <div class="compose-row"><label for="cType">Type</label>
      <select id="cType">
        <option>status-update</option>
        <option>assignment</option>
        <option>scope-change</option>
        <option>question</option>
        <option>incident-report</option>
        <option>request</option>
        <option>notification</option>
      </select>
    </div>
    <div class="compose-row"><label for="cSubject">Subject</label><input id="cSubject" placeholder="my-topic-slug" /></div>
    <div style="position:relative">
      <textarea class="compose-body" id="cBody" placeholder="Wire body… (type 3+ chars to see past prompts)" autocomplete="off"></textarea>
      <div id="promptDropdown" style="display:none;position:absolute;bottom:100%;left:0;right:0;max-height:160px;overflow-y:auto;background:var(--vscode-editorSuggestWidget-background,var(--vscode-input-background));border:1px solid var(--vscode-editorSuggestWidget-border,#555);z-index:100;font-size:11px;"></div>
    </div>
    <div class="compose-footer">
      <span class="error-bar" id="composeError"></span>
      <button class="btn btn-secondary" id="btnCancel">Cancel</button>
      <button class="btn" id="btnSend">Send</button>
    </div>
  </div>
</div>

<script>
  const vscode = acquireVsCodeApi();
  let allWires = [];
  let inboxWires = [];
  let outboxWires = [];
  let actorAlias = '';
  let flatAvailable = false;
  let activeTab = 'inbox';
  // status filter sets per tab (multi-select chips)
  let statusFilterSet = null; // Set<string> for currently active tab
  let selectedWwuid = null;
  let pendingFormatted = '';
  let searchQuery = '';
  let selectedWwuids = new Set();
  let tabStatusFilters = {};   // persist Set<string> per tab
  // UI prefs
  let hideZeroStatus = true; // default: hide Pending/Failed when count is 0

  const CHIP_CONFIG = {
    inbox:  [
      { status: 'sent',      label: 'New'       },
      { status: 'read',      label: 'Read'      },
      { status: 'archived',  label: 'Archived'  },
      { status: 'all',       label: 'All'       },
    ],
    outbox: [
      { status: 'draft',     label: 'Draft'     },
      { status: 'pending',   label: 'Pending'   },
      { status: 'failed',    label: 'Failed'    },
      { status: 'sent',      label: 'Sent'      },
      { status: 'received',  label: 'Delivered' },
      { status: 'read',      label: 'Read'      },
      { status: 'archived',  label: 'Archived'  },
      { status: 'all',       label: 'All'       },
    ],
  };

  // Initialize statusFilter to first chip's status for current tab
  function initStatusFilterSet(tab) {
    if (!tabStatusFilters[tab]) {
      const chips = CHIP_CONFIG[tab] || [];
      const s = new Set();
      if (chips.length > 0) s.add(chips[0].status);
      tabStatusFilters[tab] = s;
    }
    return tabStatusFilters[tab];
  }
  statusFilterSet = initStatusFilterSet('inbox');

  // ── Chip rendering ────────────────────────────────────────────────────────

  function renderChips(tab) {
    const bar = document.getElementById('statusFilter');
    const chips = CHIP_CONFIG[tab] || [];
    // compute counts based on base list — archived counts are exclusive
    // compute counts based on base list — archived counts are exclusive
    const base = tab === 'inbox' ? inboxWires : outboxWires;
    const counts = {};
    for (const c of chips) counts[c.status] = 0;
    for (const w of base) {
      const archived = w.recipient_archived_at || w.sender_archived_at || false;
      if (archived) {
        if (counts['archived'] !== undefined) counts['archived']++;
        continue;
      }
      const st = (w.status || (tab === 'inbox' ? 'sent' : 'sent'));
      if (counts[st] !== undefined) counts[st]++;
      // If 'all' bucket exists, we'll set it after counting
    }
    if (counts['all'] !== undefined) counts['all'] = base.length;

    // If user prefers, hide zero-count Pending/Failed chips by default
    const visibleChips = chips.filter(c => {
      if (!hideZeroStatus) return true;
      if ((c.status === 'pending' || c.status === 'failed') && (counts[c.status] || 0) === 0) return false;
      return true;
    });

    bar.innerHTML = visibleChips.map(c => {
      const active = statusFilterSet && statusFilterSet.has(c.status) ? ' active' : '';
      const count = counts[c.status] || 0;
      return '<button class="sf-btn' + active + '" data-status="' + c.status + '" aria-label="' + c.label + ', ' + count + ' items' + '">' +
        '<input type="checkbox" class="chip-checkbox" data-status="' + c.status + '" ' + (active ? 'checked' : '') + ' aria-label="Include ' + c.label + '"/>' +
        '<span class="chip-label">' + c.label + '</span>' +
        '<span class="chip-count">' + count + '</span>' +
        '</button>';
    }).join('');

    // Checkbox change toggles inclusion (multi-select). Clicking the label text selects exclusively.
    bar.querySelectorAll('.chip-checkbox').forEach(cb => {
      cb.addEventListener('change', (e) => {
        e.stopPropagation();
        const status = cb.dataset.status;
        if (!statusFilterSet) statusFilterSet = initStatusFilterSet(tab);
        if (cb.checked) statusFilterSet.add(status);
        else statusFilterSet.delete(status);
        tabStatusFilters[activeTab] = statusFilterSet;
        clearSelection();
        renderList();
        renderChips(tab); // refresh visual state
      });
    });

    bar.querySelectorAll('.sf-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        // If click originated from the checkbox, the change handler already ran.
        if (e.target.classList && e.target.classList.contains('chip-checkbox')) return;
        const status = btn.dataset.status;
        // Clicking label/text makes this selection exclusive (only this status)
        if (!statusFilterSet) statusFilterSet = initStatusFilterSet(tab);
        statusFilterSet.clear();
        statusFilterSet.add(status);
        tabStatusFilters[activeTab] = statusFilterSet;
        clearSelection();
        renderList();
        renderChips(tab);
      });
    });
    bar.classList.toggle('visible', tab === 'inbox' || tab === 'outbox');
  }

  // ── Tab switching ─────────────────────────────────────────────────────────

  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      activeTab = tab.dataset.tab;
      // Restore or initialize statusFilter for the tab
      statusFilterSet = initStatusFilterSet(activeTab);
      document.getElementById('searchBar').classList.toggle('visible', activeTab === 'all');
      clearSelection();
      renderChips(activeTab);
      renderList();
    });
  });

  // Initial chip render
  renderChips('inbox');

  // ===== Settings init =====
  try {
    const storedHide = localStorage.getItem('telegraph.hideZeroStatus');
    hideZeroStatus = storedHide === null ? true : (storedHide === 'true');
  } catch (e) { hideZeroStatus = true; }
  // sync checkbox if present
  const hideCb = document.getElementById('hideZeroStatus');
  if (hideCb) hideCb.checked = hideZeroStatus;
  // settings button
  const btnSettings = document.getElementById('btnSettings');
  const settingsMenu = document.getElementById('settingsMenu');
  if (btnSettings && settingsMenu) {
    btnSettings.addEventListener('click', (ev) => {
      ev.stopPropagation();
      settingsMenu.style.display = settingsMenu.style.display === 'block' ? 'none' : 'block';
      // ensure checkbox reflects state
      const cb = document.getElementById('hideZeroStatus'); if (cb) cb.checked = hideZeroStatus;
    });
    document.addEventListener('click', () => { if (settingsMenu) settingsMenu.style.display = 'none'; });
    const cbEl = document.getElementById('hideZeroStatus');
    if (cbEl) cbEl.addEventListener('change', (e) => {
      hideZeroStatus = e.target.checked;
      try { localStorage.setItem('telegraph.hideZeroStatus', hideZeroStatus ? 'true' : 'false'); } catch (e) {}
      renderChips(activeTab);
    });
  }

  // ===== Divider (resizable left pane) =====
  (function(){
    const listPane = document.getElementById('listPane');
    const divider = document.getElementById('divider');
    if (!listPane || !divider) return;
    // restore width
    try { const w = localStorage.getItem('telegraph.listWidth'); if (w) listPane.style.width = w; } catch (e) {}
    let dragging = false;
    const minW = 160; const maxW = 900;
    divider.addEventListener('mousedown', (e) => {
      dragging = true; document.body.style.userSelect = 'none';
    });
    window.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const rect = document.body.getBoundingClientRect();
      const newW = Math.max(minW, Math.min(maxW, e.clientX - rect.left));
      listPane.style.width = newW + 'px';
    });
    window.addEventListener('mouseup', () => {
      if (!dragging) return; dragging = false; document.body.style.userSelect = '';
      try { localStorage.setItem('telegraph.listWidth', listPane.style.width); } catch (e) {}
    });
    // keyboard support
    divider.addEventListener('keydown', (e) => {
      const cur = parseInt(getComputedStyle(listPane).width, 10) || 240;
      if (e.key === 'ArrowLeft') { const nw = Math.max(minW, cur - 16); listPane.style.width = nw + 'px'; try{localStorage.setItem('telegraph.listWidth', listPane.style.width);}catch{ } }
      if (e.key === 'ArrowRight') { const nw = Math.min(maxW, cur + 16); listPane.style.width = nw + 'px'; try{localStorage.setItem('telegraph.listWidth', listPane.style.width);}catch{ } }
    });
  })();

  document.getElementById('searchInput').addEventListener('input', (e) => {
    searchQuery = e.target.value.toLowerCase();
    renderList();
  });

  // ── Controls ──────────────────────────────────────────────────────────────

  // ── Bulk bar ──────────────────────────────────────────────────────────────

  function clearSelection() {
    selectedWwuids.clear();
    selectedWwuid = null;
    updateBulkBar();
    renderDetail(null);
  }

  function updateBulkBar() {
    const n = selectedWwuids.size;
    document.getElementById('bulkBar').classList.toggle('visible', n > 0);
    document.getElementById('selectedCount').textContent = n + ' selected';
    document.getElementById('selectAll').checked = n > 0 && n === currentList().length;
    // Sync checkboxes in list
    document.querySelectorAll('.wire-check').forEach(cb => {
      cb.checked = selectedWwuids.has(cb.dataset.wwuid);
    });
  }

  document.getElementById('selectAll').addEventListener('change', (e) => {
    if (e.target.checked) {
      currentList().forEach(w => selectedWwuids.add(w.wwuid));
    } else {
      clearSelection();
    }
    renderList();
  });

  document.getElementById('bulkApply').addEventListener('click', () => {
    const status = document.getElementById('bulkStatus').value;
    if (!status || selectedWwuids.size === 0) return;
    vscode.postMessage({ type: 'bulkStatus', wwuids: [...selectedWwuids], status, perspective: activeTab === 'inbox' ? 'recipient' : 'sender' });
    clearSelection();
  });

  document.getElementById('bulkClear').addEventListener('click', () => clearSelection());

  document.getElementById('btnRefresh').addEventListener('click', () => refresh());
  document.getElementById('btnCompose').addEventListener('click', () => toggleCompose());
  document.getElementById('btnCancel').addEventListener('click', () => toggleCompose(false));
  document.getElementById('btnSend').addEventListener('click', () => sendWire());

  document.getElementById('listPane').addEventListener('click', (e) => {
    const cb = e.target.closest('.wire-check');
    if (cb) {
      e.stopPropagation();
      if (cb.checked) selectedWwuids.add(cb.dataset.wwuid);
      else selectedWwuids.delete(cb.dataset.wwuid);
      updateBulkBar();
      return;
    }
    const row = e.target.closest('.wire-row');
    if (row && row.dataset.wwuid) selectWire(row.dataset.wwuid);
  });

  document.getElementById('detailPane').addEventListener('click', (e) => {
    const pushBtn = e.target.closest('[data-push]');
    if (pushBtn) { pushTo(pendingFormatted, pushBtn.dataset.push); return; }
    const markReadBtn = e.target.closest('[data-mark-read]');
    if (markReadBtn) { vscode.postMessage({ type: 'markRead', wwuid: markReadBtn.dataset.markRead }); return; }
    const archiveBtn = e.target.closest('[data-archive]');
    if (archiveBtn) { vscode.postMessage({ type: 'archive', wwuid: archiveBtn.dataset.archive, perspective: activeTab === 'inbox' ? 'recipient' : 'sender' }); return; }
    const retryBtn = e.target.closest('[data-retry-wire]');
    if (retryBtn) { vscode.postMessage({ type: 'retryWire', wwuid: retryBtn.dataset.retryWire }); return; }
    const replyBtn = e.target.closest('[data-reply]');
    if (replyBtn) {
      const ww = [...inboxWires, ...outboxWires, ...allWires].find(x => x.wwuid === replyBtn.dataset.reply);
      if (ww) handleReply(ww);
      return;
    }
    const editBtn = e.target.closest('[data-edit]');
    if (editBtn) {
      const ww = [...inboxWires, ...outboxWires, ...allWires].find(x => x.wwuid === editBtn.dataset.edit);
      if (ww) handleEdit(ww);
      return;
    }
    const sendDraftBtn = e.target.closest('[data-send-draft]');
    if (sendDraftBtn) { vscode.postMessage({ type: 'sendDraft', wwuid: sendDraftBtn.dataset.sendDraft }); }
  });

  // ── Messages from extension ───────────────────────────────────────────────

  window.addEventListener('message', ({ data }) => {
    if (data.type === 'wires') {
      inboxWires  = data.inbox  || [];
      outboxWires = data.outbox || [];
      allWires    = data.all    || [];
      actorAlias  = data.alias  || '';
      flatAvailable = data.flatAvailable || false;
      document.getElementById('badgeInbox').textContent  = inboxWires.length;
      document.getElementById('badgeOutbox').textContent = outboxWires.length;
      document.getElementById('badgeAll').textContent    = allWires.length;
      // Update chips counts and list after wires arrive
      clearSelection();
      renderChips(activeTab);
      renderList();
      if (selectedWwuid) renderDetail(selectedWwuid);
    }
    if (data.type === 'sent') {
      toggleCompose(false);
      clearCompose();
    }
    if (data.type === 'error') {
      document.getElementById('composeError').textContent = data.text;
    }
    if (data.type === 'promptResults') {
      renderPromptDropdown(data.results);
    }
  });

  // ── Prompt autocomplete ───────────────────────────────────────────────────

  let promptSearchTimer = null;
  const cBody = document.getElementById('cBody');
  const promptDropdown = document.getElementById('promptDropdown');

  cBody.addEventListener('input', () => {
    clearTimeout(promptSearchTimer);
    const lastLine = cBody.value.split('\\n').pop() || '';
    if (lastLine.trim().length < 3) { promptDropdown.style.display = 'none'; return; }
    promptSearchTimer = setTimeout(() => {
      vscode.postMessage({ type: 'promptSearch', query: lastLine.trim() });
    }, 250);
  });

  cBody.addEventListener('blur', () => {
    setTimeout(() => { promptDropdown.style.display = 'none'; }, 150);
  });

  function renderPromptDropdown(results) {
    if (!results || results.length === 0) { promptDropdown.style.display = 'none'; return; }
    promptDropdown.innerHTML = results.map((p, i) =>
      '<div class="prompt-item" data-idx="' + i + '" style="padding:4px 8px;cursor:pointer;border-bottom:1px solid var(--vscode-panel-border)">'
      + '<div style="font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(p.content.slice(0, 80)) + '</div>'
      + '<div style="font-size:10px;color:var(--vscode-descriptionForeground)">' + esc(p.kind + ' · ' + (p.scope_alias || p.recorder_scope) + ' · ' + p.last_used.slice(0,10)) + '</div>'
      + '</div>'
    ).join('');
    promptDropdown.style.display = 'block';
    promptDropdown.querySelectorAll('.prompt-item').forEach(el => {
      el.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const r = results[parseInt(el.dataset.idx)];
        if (r) { cBody.value = r.content; promptDropdown.style.display = 'none'; }
      });
    });
  }

  // ── List rendering ────────────────────────────────────────────────────────

  function refresh() { vscode.postMessage({ type: 'refresh' }); }

  function wireScope(addr) {
    const role = ((addr || '').match(/^([A-Za-z]+)/) || [])[1] || '';
    const r = role.toUpperCase();
    if (r === 'RA' || r === 'G') return 'territory';
    if (r === 'CD' || r === 'ACD' || r === 'S' || r === 'M') return 'county';
    return 'town';
  }

  function isArchivedForActor(w) {
    if (activeTab === 'inbox') return !!w.recipient_archived_at;
    if (activeTab === 'outbox') return !!w.sender_archived_at;
    return w.status === 'archived';
  }

  function currentList() {
    if (activeTab === 'all') {
      if (!searchQuery) return allWires;
      return allWires.filter(w =>
        (w.subject || '').toLowerCase().includes(searchQuery) ||
        (w.from    || '').toLowerCase().includes(searchQuery) ||
        (w.to      || '').toLowerCase().includes(searchQuery) ||
        (w.type    || '').toLowerCase().includes(searchQuery) ||
        (w.body    || '').toLowerCase().includes(searchQuery)
      );
    }
    const base = activeTab === 'inbox' ? inboxWires : outboxWires;
    // if no filters selected, return empty list (user-cleared selection => show none)
    const set = tabStatusFilters[activeTab] || new Set();
    if (set.size === 0) return [];
    // if 'all' present, return base
    if (set.has('all')) return base;
    // include archived if selected
    const wantsArchived = set.has('archived');
    const wanted = Array.from(set).filter(s => s !== 'archived');
    return base.filter(w => {
      // If only 'archived' is selected, return archived items only
      if (wantsArchived && wanted.length === 0) return isArchivedForActor(w);
      // If archived is selected along with other statuses, include archived items as well
      if (wantsArchived && isArchivedForActor(w)) return true;
      // Otherwise, if no non-archived statuses selected, show non-archived items
      if (wanted.length === 0) return !isArchivedForActor(w);
      const st = (w.status || 'sent');
      return wanted.includes(st) && !isArchivedForActor(w);
    });
  }

  function renderList() {
    const pane = document.getElementById('listPane');
    const list = currentList();
    if (list.length === 0) {
      const msg = !flatAvailable
        ? 'telegraph/flat/ not found'
        : (function(){
            if (activeTab === 'all') return searchQuery ? 'No matches' : 'No wires';
            const set = tabStatusFilters[activeTab] || new Set();
            if (set.size === 0) return activeTab === 'inbox' ? 'No New wires' : 'No Draft wires';
            if (set.has('all')) return activeTab === 'inbox' ? 'Inbox empty' : 'No sent wires';
            // show first selected label if possible
            const first = Array.from(set)[0];
            const cfg = CHIP_CONFIG[activeTab] || [];
            const found = cfg.find(c => c.status === first);
            return 'No ' + (found ? found.label : first) + ' wires';
          })();
      pane.innerHTML = '<div class="empty-list">' + esc(msg) + '</div>';
      return;
    }

    if (activeTab === 'inbox' || activeTab === 'outbox') {
      const addrField = activeTab === 'inbox' ? 'to' : 'from';
      const groups = { town: [], county: [], territory: [] };
      for (const w of list) groups[wireScope(w[addrField] || '')].push(w);
      const LABELS = { town: 'Town', county: 'County', territory: 'Territory' };
      let html = '';
      for (const key of ['town', 'county', 'territory']) {
        const wires = groups[key];
        if (!wires.length) continue;
        html += '<div class="scope-header">' + esc(LABELS[key]) + ' · ' + wires.length + '</div>';
        html += wires.map(w => wireRow(w)).join('');
      }
      pane.innerHTML = html;
    } else {
      pane.innerHTML = list.map(w => wireRow(w)).join('');
    }
  }

  function wireRow(w) {
    const active = w.wwuid === selectedWwuid ? ' active' : '';
    const checked = selectedWwuids.has(w.wwuid) ? ' checked' : '';
    // If this wire is archived for the current actor, show 'Archived' badge and archived timestamp in meta
    const archivedForActor = isArchivedForActor(w);
    // show date + time in list rows
    let dateStr = w.date ? fmtDate(w.date) : '';
    let statusLabel = w.status === 'sent' ? 'New' : (w.status || '');
    let statusBadge = '<span class="badge-status badge-' + esc(w.status || 'sent') + '">' + esc(statusLabel) + '</span>';
    if (archivedForActor) {
      statusLabel = 'Archived';
      statusBadge = '<span class="badge-status badge-archived">' + esc(statusLabel) + '</span>';
      // prefer actor-specific archived timestamp when present
      const archivedIso = (activeTab === 'inbox' ? w.recipient_archived_at : (activeTab === 'outbox' ? w.sender_archived_at : (w.recipient_archived_at || w.sender_archived_at || w.archived_at)));
      if (archivedIso) {
        try { dateStr = fmtDate(archivedIso); } catch (e) { /* ignore */ }
      }
    }
    const shortId = w.wwuid ? w.wwuid.slice(0, 8) : '—';
    // For outbox rows, show To: <recipient>, for inbox show From: <sender>
    const addrDisplay = activeTab === 'outbox' ? ('To: ' + esc(w.to || '—')) : ('From: ' + esc(w.from || '—'));
    return '<div class="wire-row' + active + '" data-wwuid="' + esc(w.wwuid) + '">'
      + '<input type="checkbox" class="wire-check"' + checked + ' data-wwuid="' + esc(w.wwuid) + '">'
      + '<div class="wire-content">'
      + '<div class="subject">' + esc(w.subject || w.filename || '—') + '</div>'
      + '<div class="meta">' + statusBadge + ' <span>' + addrDisplay + '</span> <span>' + esc(dateStr) + '</span></div>'
      + '<div class="meta" style="opacity:0.45;font-family:monospace">' + esc(shortId) + '</div>'
      + '</div>'
      + '</div>';
  }

  // ── Detail rendering ──────────────────────────────────────────────────────

  function selectWire(wwuid) {
    selectedWwuid = wwuid;
    renderList();
    renderDetail(wwuid);
  }

  function renderDetail(wwuid) {
    const w = [...inboxWires, ...outboxWires, ...allWires].find(x => x.wwuid === wwuid);
    const pane = document.getElementById('detailPane');
    if (!w) {
      pane.className = 'detail-pane empty-detail';
      pane.innerHTML = '<span>Select a wire to read</span>';
      return;
    }
    pane.className = 'detail-pane';
    const dateStr = w.date ? new Date(w.date).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
    pendingFormatted = '[from ' + (w.from||'?') + ' → ' + (w.to||'?') + '] ' + (w.subject||'') + '\\n\\n' + (w.body||'');

    let html = '<table class="wire-meta-table">';
    if (w.from)         html += metaRow('From', w.from);
    if (w.to)           html += metaRow('To', w.to);
                        html += metaRow('Date', dateStr);
                        html += metaRow('Subject', w.subject);
                        html += metaRow('Type', w.type);
    if (w.delivered_at) html += metaRow('Delivered', fmtDate(w.delivered_at));
    if (w.failed_at)    html += metaRow('Failed', fmtDate(w.failed_at));
    if (w.re)           html += metaRow('Re', w.re);
    if (w.original_wire) html += metaRow('Re wire', w.original_wire);
    html += '</table>';

    if (w.failure) {
      html += '<div class="wire-body" style="border-color:var(--vscode-inputValidation-errorBorder,#be1100)">'
        + '<div class="section-label" style="margin-bottom:6px">Failure</div>'
        + esc(w.failure.message || w.failure.reason || 'Delivery failed')
        + (w.failure.field ? '<div style="margin-top:4px;opacity:0.65">Field: ' + esc(w.failure.field) + '</div>' : '')
        + '</div>';
    }

    // Body
    const bodyText = (w.body || '').trim();
    html += '<div class="wire-body' + (bodyText ? '' : ' empty') + '">'
      + (bodyText ? esc(bodyText) : '(no body)') + '</div>';

    // Wire Id (show above timeline)
    html += '<div style="font-family:monospace;font-size:11px;margin-top:12px;margin-bottom:8px;opacity:0.8">Wire Id: ' + esc(w.wwuid || '') + '</div>';

    // Status timeline (include status_transitions and actor-specific archive overlay)
    html += '<div><div class="section-label" style="margin-bottom:6px">Timeline</div><div class="timeline">';
    if (w.status_transitions && w.status_transitions.length > 0) {
      for (const t of w.status_transitions) {
        const actor = [t.by, t.scope, t.alias].filter(Boolean).join(' · ');
        const source = [t.tool, t.source].filter(Boolean).join(' / ') || (t.repos && t.repos.length ? t.repos.join(', ') : '');
        html += '<div class="timeline-item"><div class="timeline-dot"></div><div>'
          + '<strong>' + esc(t.status) + '</strong> — ' + esc(fmtDate(t.timestamp))
          + (actor ? ' <span style="opacity:0.7">by ' + esc(actor) + '</span>' : '')
          + (source ? ' <span style="opacity:0.55">(' + esc(source) + ')</span>' : '')
          + '</div></div>';
      }
    }
    // Add archived overlay as timeline item if present for actor — show actual actor identity
    const archivedIso = (activeTab === 'inbox' ? w.recipient_archived_at : (activeTab === 'outbox' ? w.sender_archived_at : (w.recipient_archived_at || w.sender_archived_at)));
    if (archivedIso) {
      const archivedActor = (activeTab === 'inbox') ? (w.to || 'recipient') : (activeTab === 'outbox') ? (w.from || 'sender') : (w.recipient || w.sender || w.from || w.to || 'actor');
      html += '<div class="timeline-item"><div class="timeline-dot"></div><div>'
        + '<strong>archived</strong> — ' + esc(fmtDate(archivedIso))
        + (archivedActor ? ' <span style="opacity:0.7">by ' + esc(archivedActor) + '</span>' : '')
        + '</div></div>';
    }
    html += '</div></div>';

    // Push bar + actions
    const status = w.status || 'received';
    const isInboxWire = !!inboxWires.find(x => x.wwuid === w.wwuid);
    const isArchivedActor = isInboxWire ? !!w.recipient_archived_at : !!w.sender_archived_at;
    html += '<div class="push-bar">'
      + '<button class="btn" data-push="copilot">→ Copilot</button>'
      + '<button class="btn btn-secondary" data-push="claude">→ Claude</button>'
      + '<button class="btn btn-secondary" data-push="codex">→ Codex</button>'
      + (status === 'draft' ? '<button class="btn" data-send-draft="' + esc(w.wwuid) + '">Send</button>' : '')
      + (status === 'draft' && activeTab === 'outbox' ? '<button class="btn" data-edit="' + esc(w.wwuid) + '">Edit</button>' : '')
      + (status === 'failed' ? '<button class="btn" data-retry-wire="' + esc(w.wwuid) + '">Retry Now</button>' : '')
      + (isInboxWire && !isArchivedActor && (status === 'sent' || status === 'received' || status === 'delivered') ? '<button class="btn" data-mark-read="' + esc(w.wwuid) + '">Mark Read</button>' : '')
      + (isInboxWire && !isArchivedActor && status !== 'draft' ? '<button class="btn" data-reply="' + esc(w.wwuid) + '">↻ Reply</button>' : '')
      + (!isArchivedActor ? '<button class="btn btn-secondary" data-archive="' + esc(w.wwuid) + '">Archive</button>' : '')
      + '</div>';

    pane.innerHTML = html;
  }

  function metaRow(label, val) {
    return '<tr><td>' + esc(label) + '</td><td>' + esc(val || '—') + '</td></tr>';
  }

  function fmtDate(iso) {
    try { return new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }
    catch { return iso; }
  }

  function pushTo(formatted, target) {
    if (target === 'copilot') {
      vscode.postMessage({ type: 'pushToCopilot', formatted });
    } else {
      vscode.postMessage({ type: 'pushToTerminal', formatted, label: target });
    }
  }

  // ── Compose ───────────────────────────────────────────────────────────────

  function toggleCompose(forceOpen) {
    const drawer = document.getElementById('composeDrawer');
    const isOpen = drawer.classList.contains('open');
    if (forceOpen === false || isOpen) {
      drawer.classList.remove('open');
    } else {
      drawer.classList.add('open');
      document.getElementById('cTo').focus();
    }
  }

  function clearCompose() {
    ['cTo','cSubject','cBody'].forEach(id => document.getElementById(id).value = '');
    document.getElementById('cType').selectedIndex = 0;
    document.getElementById('composeError').textContent = '';
  }

  function sendWire() {
    document.getElementById('composeError').textContent = '';
    vscode.postMessage({
      type: 'send',
      to: document.getElementById('cTo').value,
      wireType: document.getElementById('cType').value,
      subject: document.getElementById('cSubject').value,
      body: document.getElementById('cBody').value,
    });
  }

  function esc(s) {
    return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function handleReply(wire) {
    // Swap sender/recipient for reply
    const replyTo = wire.from;
    const originalSubject = wire.subject || 'untitled';
    const reSubject = originalSubject.startsWith('re:') ? originalSubject : 're: ' + originalSubject;

    // Open compose drawer with reply fields pre-filled
    document.getElementById('cTo').value = replyTo;
    document.getElementById('cSubject').value = reSubject;
    document.getElementById('cBody').value = '';
    document.getElementById('cType').value = 'status-update';
    document.getElementById('composeError').textContent = '';
    toggleCompose(true);
    document.getElementById('cBody').focus();

    // Store reply metadata for sending
    window.replyToWwuid = wire.wwuid;
  }

  function handleEdit(wire) {
    // Prefill compose drawer with draft wire fields for editing
    document.getElementById('cTo').value = wire.to || '';
    document.getElementById('cSubject').value = wire.subject || '';
    document.getElementById('cBody').value = wire.body || '';
    document.getElementById('cType').value = wire.type || 'status-update';
    document.getElementById('composeError').textContent = '';
    toggleCompose(true);
    document.getElementById('cBody').focus();
    window.editingWire = wire.wwuid;
  }

  refresh();
</script>
</body>
</html>`;
  }

  dispose(): void {
    TelegraphPanel.instance = undefined;
    this.disposables.forEach(d => d.dispose());
    this.disposables = [];
  }
}
