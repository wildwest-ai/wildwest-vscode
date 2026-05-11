import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { FlatWire, createFlatWire, writeFlatWire, writeDraftWire, parseFilenameActors } from './WireFactory';
import { readRegistryAlias } from './TelegraphService';
import { PromptIndexService } from './PromptIndexService';

/** New protocol: wire files are always {wwuid}.json */
const UUID_FILE_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.json$/;

export class TelegraphPanel {
  static readonly viewType = 'wildwest.telegraphPanel';
  private static instance: TelegraphPanel | undefined;

  private readonly panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];
  private static outputChannel = vscode.window.createOutputChannel('Wild West Telegraph');

  static open(exportPath: string, promptIndex?: PromptIndexService): void {
    if (TelegraphPanel.instance) {
      TelegraphPanel.instance.panel.reveal();
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      TelegraphPanel.viewType,
      '📬 Telegraph',
      vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    TelegraphPanel.instance = new TelegraphPanel(panel, promptIndex);
  }

  private constructor(
    panel: vscode.WebviewPanel,
    private readonly promptIndex?: PromptIndexService,
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
   * Returns the workspace-local flat/ directory, which HeartbeatMonitor writes
   * delivered wires into with status 'sent' (recipient perspective).
   * Different from the territory flat/ which holds the sender's 'delivered' view.
   */
  private getWorkspaceFlatDir(): string | null {
    const wsPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
    if (!wsPath) return null;
    const dir = path.join(wsPath, '.wildwest', 'telegraph', 'flat');
    return fs.existsSync(dir) ? dir : null;
  }

  private getActorAlias(): string {
    const wsPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
    return readRegistryAlias(path.join(wsPath, '.wildwest')) ?? '';
  }

  /**
   * True if a `to`/`from` address field belongs to this actor.
   *
   * Canonical formats only (legacy normalized by migration script):
   *   TM(wildwest-vscode)   — role(alias)
   *   CD(RSn)               — role(dyad)
   *   CD(RSn).Cld           — role(dyad).channel
   *   TM(*vscode)           — glob: alias ends with suffix
   *   wildwest-vscode       — bare alias
   */
  private addressMatchesSelf(field: string, alias: string, identity: string): boolean {
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

  // ── Read flat/ wires ──────────────────────────────────────────────────────

  /**
   * Read all wires for panel display.
   * - Territory flat/ (~/wildwest/telegraph/flat/) is the SSOT for sent/received/read/archived.
   * - Local .wildwest/telegraph/flat/ holds draft/pending wires (sender's local PO) only.
   *   These are merged in for Outbox view; territory wins on any wwuid conflict.
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
    const territoryDir = this.getFlatDir();
    const wsDir = this.getWorkspaceFlatDir();

    const byWwuid = new Map<string, FlatWire>();

    // 1. Load territory first (authoritative for sent and beyond)
    if (territoryDir) {
      let entries: string[];
      try { entries = fs.readdirSync(territoryDir); } catch { entries = []; }
      for (const f of entries) {
        if (!f.endsWith('.json') || f.startsWith('.') || !UUID_FILE_RE.test(f)) continue;
        try {
          const wire = JSON.parse(fs.readFileSync(path.join(territoryDir, f), 'utf8')) as FlatWire;
          if (!wire.from || !wire.to) {
            const parsed = parseFilenameActors(wire.filename);
            if (!wire.from && parsed.from) wire.from = parsed.from;
            if (!wire.to && parsed.to) wire.to = parsed.to;
          }
          const key = wire.wwuid ?? f.replace('.json', '');
          byWwuid.set(key, wire);
        } catch { /* skip corrupt */ }
      }
    }

    // 2. Load local draft/pending wires (territory does NOT have these yet)
    if (wsDir) {
      let entries: string[];
      try { entries = fs.readdirSync(wsDir); } catch { entries = []; }
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
          // Only add local wire if territory does NOT already have it.
          // Exception: merge overlay fields (archive) from local onto territory wire.
          if (!byWwuid.has(key)) {
            byWwuid.set(key, wire);
          } else {
            const existing = byWwuid.get(key)!;
            if (wire.sender_archived_at) existing.sender_archived_at = wire.sender_archived_at;
            if (wire.recipient_archived_at) existing.recipient_archived_at = wire.recipient_archived_at;
          }
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
    const all = this.readAllFlatWires();
    const alias = this.getActorAlias();
    const identity = vscode.workspace.getConfiguration('wildwest').get<string>('identity') ?? '';
    const { inbox, outbox } = this.filterWires(all, alias, identity);
    const flatAvailable = this.getFlatDir() !== null;
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
        this.handleArchiveWire(msg['wwuid'] as string);
        break;
      case 'markRead':
        this.handleMarkRead(msg['wwuid'] as string);
        break;
      case 'sendDraft':
        this.handleSendDraft(msg['wwuid'] as string);
        break;
      case 'bulkStatus': {
        const wwuids = msg['wwuids'] as string[];
        const status = msg['status'] as string;
        this.handleBulkStatus(wwuids, status);
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
    const fromActor = alias ? `${role}(${alias})` : (identity || 'TM');

    const wire = createFlatWire({ from: fromActor, to, type, subject, body, status: 'pending' });

    // Compose Send → write as pending to local outbox/ for heartbeat pickup.
    // Heartbeat operator promotes to territory SSOT as 'sent'.
    const outboxDir = path.join(wsPath, '.wildwest', 'telegraph', 'outbox');
    fs.mkdirSync(outboxDir, { recursive: true });
    fs.writeFileSync(path.join(outboxDir, wire.filename), JSON.stringify(wire, null, 2), 'utf8');

    // Also save to local flat/ so it shows in Outbox > Pending immediately
    writeDraftWire(wire, wsPath);

    this.panel.webview.postMessage({ type: 'sent', wire });
    this.sendWires();
  }

  private handleBulkStatus(wwuids: string[], status: string): void {
    const flatDir = this.getFlatDir();
    const wsDir = this.getWorkspaceFlatDir();
    this.log(`handleBulkStatus: wwuids=${JSON.stringify(wwuids)} status=${status} flatDir=${flatDir} wsDir=${wsDir}`);
    if (!wwuids?.length || !status) { this.log('handleBulkStatus: early exit — no wwuids or status'); return; }
    // Archive uses overlay pattern — delegate to handleArchiveWire per wire
    if (status === 'archived') {
      for (const wwuid of wwuids) this.handleArchiveWire(wwuid);
      return; // sendWires called inside handleArchiveWire
    }
    if (status === 'read') {
      for (const wwuid of wwuids) this.handleMarkRead(wwuid);
      return; // sendWires called inside handleMarkRead
    }
    const isoNow = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
    for (const wwuid of wwuids) {
      // Prefer territory for sent/received/read; fall back to local for draft/pending
      const dirs = flatDir ? [flatDir] : [];
      if (wsDir) dirs.push(wsDir);
      for (const dir of dirs) {
        const filePath = this.findWireFilePath(wwuid, dir);
        if (!filePath) continue;
        try {
          const wire = JSON.parse(fs.readFileSync(filePath, 'utf8')) as FlatWire;
          wire.status = status;
          wire.status_transitions = [
            ...(wire.status_transitions ?? []),
            { status, timestamp: isoNow, repos: ['vscode'] },
          ];
          fs.writeFileSync(filePath, JSON.stringify(wire, null, 2), 'utf8');
        } catch { /* skip */ }
        break; // only write to first dir that has the file
      }
    }
    this.sendWires();
  }

  private handleSendDraft(wwuid: string): void {
    // Draft lives in local flat/; promote to pending and move to outbox for heartbeat pickup.
    const wsPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
    const localFlatDir = path.join(wsPath, '.wildwest', 'telegraph', 'flat');
    const localFilePath = path.join(localFlatDir, `${wwuid}.json`);
    if (!wwuid || !fs.existsSync(localFilePath)) return;
    try {
      const wire = JSON.parse(fs.readFileSync(localFilePath, 'utf8')) as FlatWire;
      const isoNow = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
      wire.status = 'pending';
      wire.status_transitions = [
        ...(wire.status_transitions ?? []),
        { status: 'pending', timestamp: isoNow, repos: ['vscode'] },
      ];
      // Update local flat/ so Outbox shows Pending
      fs.writeFileSync(localFilePath, JSON.stringify(wire, null, 2), 'utf8');
      // Drop in workspace outbox/ for heartbeat pickup
      const outboxDir = path.join(wsPath, '.wildwest', 'telegraph', 'outbox');
      fs.mkdirSync(outboxDir, { recursive: true });
      fs.writeFileSync(path.join(outboxDir, wire.filename), JSON.stringify(wire, null, 2), 'utf8');
      vscode.window.showInformationMessage(`Wild West: wire pending — operator will deliver on next heartbeat.`);
      this.sendWires();
    } catch (err) {
      vscode.window.showErrorMessage(`Wild West: send draft failed — ${err}`);
    }
  }

  private handleMarkRead(wwuid: string): void {
    const flatDir = this.getFlatDir();
    const wsDir = this.getWorkspaceFlatDir();
    this.log(`handleMarkRead: wwuid=${wwuid} flatDir=${flatDir} wsDir=${wsDir}`);
    if (!wwuid) { this.log('handleMarkRead: early exit — no wwuid'); return; }
    // Try territory first (authoritative), fall back to workspace local
    const dirs: string[] = [];
    if (flatDir) dirs.push(flatDir);
    if (wsDir) dirs.push(wsDir);
    const isoNow = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
    for (const dir of dirs) {
      const filePath = this.findWireFilePath(wwuid, dir);
      this.log(`handleMarkRead: checking ${dir} → ${filePath ?? 'not found'}`);
      if (!filePath) continue;
      try {
        const wire = JSON.parse(fs.readFileSync(filePath, 'utf8')) as FlatWire;
        if (wire.status === 'read') { this.log('handleMarkRead: already read, skip'); return; }
        wire.status = 'read';
        wire.read_at = isoNow;
        wire.status_transitions = [
          ...(wire.status_transitions ?? []),
          { status: 'read', timestamp: isoNow, repos: ['vscode'] },
        ];
        fs.writeFileSync(filePath, JSON.stringify(wire, null, 2), 'utf8');
        this.log(`handleMarkRead: wrote read status to ${filePath}`);
        this.sendWires();
      } catch (err) { this.log(`handleMarkRead: error ${err}`); }
      return;
    }
    this.log(`handleMarkRead: no file found in dirs=${JSON.stringify(dirs)}`);
  }

  private handleArchiveWire(wwuid: string): void {
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
      const isSender = this.addressMatchesSelf(wire.from ?? '', alias, identity);
      const overlayField = isSender ? 'sender_archived_at' : 'recipient_archived_at';
      this.log(`handleArchiveWire: wire.from=${wire.from} wire.to=${wire.to} isSender=${isSender} overlayField=${overlayField}`);

      // Write overlay to local flat/ (not territory)
      fs.mkdirSync(localDir, { recursive: true });
      const localWire = fs.existsSync(localPath)
        ? JSON.parse(fs.readFileSync(localPath, 'utf8')) as Record<string, unknown>
        : { ...wire } as Record<string, unknown>;
      localWire[overlayField] = isoNow;
      fs.writeFileSync(localPath, JSON.stringify(localWire, null, 2), 'utf8');
      console.log('Wild West: archived wire locally', { wwuid, overlayField, path: localPath });

      // If both parties have now archived (overlay fields both set), promote territory to archived
      const bothArchived =
        localWire['sender_archived_at'] && localWire['recipient_archived_at'];
      const territoryFilePath = flatDir ? this.findWireFilePath(wwuid, flatDir) : null;
      if (bothArchived && territoryFilePath) {
        try {
          const tw = JSON.parse(fs.readFileSync(territoryFilePath, 'utf8')) as Record<string, unknown>;
          tw['status'] = 'archived';
          tw['sender_archived_at'] = localWire['sender_archived_at'];
          tw['recipient_archived_at'] = localWire['recipient_archived_at'];
          tw['status_transitions'] = [
            ...((tw['status_transitions'] as unknown[]) ?? []),
            { status: 'archived', timestamp: isoNow, repos: ['vscode'] },
          ];
          fs.writeFileSync(territoryFilePath, JSON.stringify(tw, null, 2), 'utf8');
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
  .btn { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 4px 10px; border-radius: 3px; cursor: pointer; font-size: 12px; }
  .btn:hover { background: var(--vscode-button-hoverBackground); }
  .btn-secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  .btn-secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }

  /* ── Tabs ── */
  .tabs { display: flex; border-bottom: 1px solid var(--vscode-panel-border); flex-shrink: 0; }
  .tab { padding: 6px 14px; font-size: 12px; cursor: pointer; border-bottom: 2px solid transparent; color: var(--vscode-descriptionForeground); user-select: none; }
  .tab:hover { color: var(--vscode-foreground); }
  .tab.active { color: var(--vscode-foreground); border-bottom-color: var(--vscode-focusBorder); }
  .tab .badge { display: inline-block; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); font-size: 10px; border-radius: 8px; padding: 0 5px; margin-left: 4px; }

  /* ── Search (All tab) ── */
  .search-bar { padding: 6px 10px; border-bottom: 1px solid var(--vscode-panel-border); flex-shrink: 0; display: none; }
  .search-bar.visible { display: block; }
  .search-bar input { width: 100%; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, #555); padding: 3px 6px; font-size: 12px; border-radius: 2px; }

  /* ── Main layout ── */
  .main { display: flex; flex: 1; overflow: hidden; }

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
  .status-filter { display: none; gap: 6px; padding: 5px 10px; border-bottom: 1px solid var(--vscode-panel-border); flex-shrink: 0; }
  .status-filter.visible { display: flex; }
  .sf-btn { background: none; border: 1px solid var(--vscode-panel-border); color: var(--vscode-descriptionForeground); font-size: 11px; padding: 1px 8px; border-radius: 10px; cursor: pointer; }
  .sf-btn:hover { color: var(--vscode-foreground); }
  .sf-btn.active { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border-color: var(--vscode-button-background); }

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
  <h2>📬 Telegraph</h2>
  <div style="display:flex;gap:6px">
    <button class="btn btn-secondary" id="btnRefresh">↻</button>
    <button class="btn" id="btnCompose">✎ Compose</button>
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
  <div class="detail-pane empty-detail" id="detailPane">
    <span>Select a wire to read</span>
  </div>
</div>

<div class="compose-drawer" id="composeDrawer">
  <div class="compose-form">
    <div class="compose-row"><label>To</label><input id="cTo" placeholder="CD(RSn)" /></div>
    <div class="compose-row"><label>Type</label>
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
    <div class="compose-row"><label>Subject</label><input id="cSubject" placeholder="my-topic-slug" /></div>
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
  let statusFilter = null;   // will be initialized to first chip's status
  let selectedWwuid = null;
  let pendingFormatted = '';
  let searchQuery = '';
  let selectedWwuids = new Set();
  let tabStatusFilters = {};   // persist statusFilter per tab

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
      { status: 'sent',      label: 'Sent'      },
      { status: 'received',  label: 'Delivered' },
      { status: 'read',      label: 'Read'      },
      { status: 'archived',  label: 'Archived'  },
      { status: 'all',       label: 'All'       },
    ],
  };

  // Initialize statusFilter to first chip's status for current tab
  function initStatusFilter(tab) {
    if (!tabStatusFilters[tab]) {
      const chips = CHIP_CONFIG[tab] || [];
      tabStatusFilters[tab] = chips.length > 0 ? chips[0].status : 'all';
    }
    return tabStatusFilters[tab];
  }
  statusFilter = initStatusFilter('inbox');

  // ── Chip rendering ────────────────────────────────────────────────────────

  function renderChips(tab) {
    const bar = document.getElementById('statusFilter');
    const chips = CHIP_CONFIG[tab] || [];
    bar.innerHTML = chips.map(c =>
      '<button class="sf-btn' + (c.status === statusFilter ? ' active' : '') + '" data-status="' + c.status + '">' + c.label + '</button>'
    ).join('');
    bar.querySelectorAll('.sf-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        bar.querySelectorAll('.sf-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        statusFilter = btn.dataset.status;
        tabStatusFilters[activeTab] = statusFilter;   // persist for this tab
        clearSelection();
        renderList();
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
      statusFilter = initStatusFilter(activeTab);
      document.getElementById('searchBar').classList.toggle('visible', activeTab === 'all');
      clearSelection();
      renderChips(activeTab);
      renderList();
    });
  });

  // Initial chip render
  renderChips('inbox');

  document.getElementById('searchInput').addEventListener('input', (e) => {
    searchQuery = e.target.value.toLowerCase();
    renderList();
  });

  // ── Controls ──────────────────────────────────────────────────────────────

  // ── Bulk bar ──────────────────────────────────────────────────────────────

  function clearSelection() {
    selectedWwuids.clear();
    updateBulkBar();
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
    vscode.postMessage({ type: 'bulkStatus', wwuids: [...selectedWwuids], status });
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
    if (archiveBtn) { vscode.postMessage({ type: 'archive', wwuid: archiveBtn.dataset.archive }); return; }
    const replyBtn = e.target.closest('[data-reply]');
    if (replyBtn) {
      const ww = [...inboxWires, ...outboxWires, ...allWires].find(x => x.wwuid === replyBtn.dataset.reply);
      if (ww) handleReply(ww);
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
      clearSelection();
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
    if (statusFilter === 'all') return base;
    if (statusFilter === 'archived') return base.filter(w => isArchivedForActor(w));
    return base.filter(w => !isArchivedForActor(w) && (w.status || 'sent') === statusFilter);
  }

  function renderList() {
    const pane = document.getElementById('listPane');
    const list = currentList();
    if (list.length === 0) {
      const msg = !flatAvailable
        ? 'telegraph/flat/ not found'
        : activeTab === 'inbox'  ? (statusFilter !== 'all' ? 'No ' + statusFilter + ' wires' : 'Inbox empty')
        : activeTab === 'outbox' ? (statusFilter !== 'all' ? 'No ' + statusFilter + ' wires' : 'No sent wires')
        : searchQuery            ? 'No matches'
        : 'No wires';
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
    const dateStr = w.date ? new Date(w.date).toLocaleDateString([], { month: 'short', day: 'numeric' }) : '';
    const statusLabel = w.status === 'sent' ? 'New' : (w.status || '');
    const statusBadge = '<span class="badge-status badge-' + esc(w.status || 'sent') + '">' + esc(statusLabel) + '</span>';
    const shortId = w.wwuid ? w.wwuid.slice(0, 8) : '—';
    return '<div class="wire-row' + active + '" data-wwuid="' + esc(w.wwuid) + '">'
      + '<input type="checkbox" class="wire-check"' + checked + ' data-wwuid="' + esc(w.wwuid) + '">'
      + '<div class="wire-content">'
      + '<div class="subject">' + esc(w.subject || w.filename || '—') + '</div>'
      + '<div class="meta">' + statusBadge + ' <span>' + esc(w.from || w.to || '') + '</span> <span>' + esc(dateStr) + '</span></div>'
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
    if (w.re)           html += metaRow('Re', w.re);
    if (w.original_wire) html += metaRow('Re wire', w.original_wire);
    html += '</table>';

    // Body
    const bodyText = (w.body || '').trim();
    html += '<div class="wire-body' + (bodyText ? '' : ' empty') + '">'
      + (bodyText ? esc(bodyText) : '(no body)') + '</div>';

    // Status timeline
    if (w.status_transitions && w.status_transitions.length > 0) {
      html += '<div><div class="section-label" style="margin-bottom:6px">Timeline</div><div class="timeline">';
      for (const t of w.status_transitions) {
        html += '<div class="timeline-item"><div class="timeline-dot"></div><div>'
          + '<strong>' + esc(t.status) + '</strong> — ' + esc(fmtDate(t.timestamp))
          + (t.repos && t.repos.length ? ' <span style="opacity:0.7">(' + esc(t.repos.join(', ')) + ')</span>' : '')
          + '</div></div>';
      }
      html += '</div></div>';
    }

    // wwuid
    html += '<div style="font-family:monospace;font-size:10px;opacity:0.5;word-break:break-all">' + esc(w.wwuid || '') + '</div>';

    // Push bar + actions
    const status = w.status || 'received';
    const isInboxWire = !!inboxWires.find(x => x.wwuid === w.wwuid);
    const isArchivedActor = isInboxWire ? !!w.recipient_archived_at : !!w.sender_archived_at;
    html += '<div class="push-bar">'
      + '<button class="btn" data-push="copilot">→ Copilot</button>'
      + '<button class="btn btn-secondary" data-push="claude">→ Claude</button>'
      + '<button class="btn btn-secondary" data-push="codex">→ Codex</button>'
      + (status === 'draft' ? '<button class="btn" data-send-draft="' + esc(w.wwuid) + '">Send</button>' : '')
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
