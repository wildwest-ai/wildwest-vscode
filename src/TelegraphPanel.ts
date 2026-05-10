import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { FlatWire, createFlatWire, writeFlatWire, parseFilenameActors } from './WireFactory';
import { readRegistryAlias } from './TelegraphService';
import { PromptIndexService } from './PromptIndexService';

export class TelegraphPanel {
  static readonly viewType = 'wildwest.telegraphPanel';
  private static instance: TelegraphPanel | undefined;

  private readonly panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];

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

  private getActorAlias(): string {
    const wsPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
    return readRegistryAlias(path.join(wsPath, '.wildwest')) ?? '';
  }

  /** Match terms for inbox/outbox filter — registry alias + identity role prefix. */
  private getMatchTerms(): string[] {
    const alias = this.getActorAlias();
    const identity = vscode.workspace.getConfiguration('wildwest').get<string>('identity') ?? '';
    const terms = new Set<string>();
    if (alias) terms.add(alias.toLowerCase());
    if (identity) {
      terms.add(identity.toLowerCase());
      const roleMatch = identity.match(/^([A-Za-z]+)/);
      if (roleMatch) terms.add(roleMatch[1].toLowerCase());
    }
    return [...terms];
  }

  // ── Read flat/ wires ──────────────────────────────────────────────────────

  private readAllFlatWires(): FlatWire[] {
    const flatDir = this.getFlatDir();
    if (!flatDir) return [];

    const results: FlatWire[] = [];
    let entries: string[];
    try {
      entries = fs.readdirSync(flatDir);
    } catch {
      return [];
    }

    for (const f of entries) {
      if (!f.endsWith('.json') || f.startsWith('.')) continue;
      try {
        const wire = JSON.parse(fs.readFileSync(path.join(flatDir, f), 'utf8')) as FlatWire;
        // Backfill from/to from filename if missing in JSON
        if (!wire.from || !wire.to) {
          const parsed = parseFilenameActors(wire.filename);
          if (!wire.from && parsed.from) wire.from = parsed.from;
          if (!wire.to && parsed.to) wire.to = parsed.to;
        }
        results.push(wire);
      } catch { /* skip corrupt */ }
    }

    return results.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }

  private filterWires(all: FlatWire[], terms: string[]): { inbox: FlatWire[]; outbox: FlatWire[] } {
    if (!terms.length) return { inbox: [], outbox: [] };
    const match = (field: string) => terms.some((t) => field.toLowerCase().includes(t));
    return {
      inbox:  all.filter((w) => match(w.to   ?? '')),
      outbox: all.filter((w) => match(w.from  ?? '')),
    };
  }

  // ── Outbound to webview ───────────────────────────────────────────────────

  private sendWires(): void {
    const all = this.readAllFlatWires();
    const alias = this.getActorAlias();
    const { inbox, outbox } = this.filterWires(all, this.getMatchTerms());
    const flatAvailable = this.getFlatDir() !== null;
    this.panel.webview.postMessage({ type: 'wires', inbox, outbox, all, alias, flatAvailable });
  }

  // ── Inbound from webview ──────────────────────────────────────────────────

  private async onMessage(msg: Record<string, unknown>): Promise<void> {
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

    const wire = createFlatWire({ from: fromActor, to, type, subject, body });

    // Primary: write directly to flat/ (territory SSOT)
    const flatDir = this.getFlatDir();
    if (flatDir) {
      writeFlatWire(wire, flatDir);
    }

    // Secondary: also drop in workspace outbox for actors relying on inbox delivery
    const outboxDir = path.join(wsPath, '.wildwest', 'telegraph', 'outbox');
    if (fs.existsSync(path.dirname(outboxDir))) {
      fs.mkdirSync(outboxDir, { recursive: true });
      fs.writeFileSync(path.join(outboxDir, wire.filename), JSON.stringify(wire, null, 2), 'utf8');
    }

    this.panel.webview.postMessage({ type: 'sent', wire });
    this.sendWires();
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
  .wire-row { padding: 7px 10px; cursor: pointer; border-left: 3px solid transparent; }
  .wire-row:hover { background: var(--vscode-list-hoverBackground); }
  .wire-row.active { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); border-left-color: var(--vscode-focusBorder); }
  .wire-row .subject { font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .wire-row .meta { font-size: 10px; color: var(--vscode-descriptionForeground); margin-top: 2px; display: flex; gap: 4px; align-items: center; }
  .wire-row.active .meta { color: var(--vscode-list-activeSelectionForeground); opacity: 0.8; }
  .empty-list { padding: 16px 10px; font-size: 12px; color: var(--vscode-descriptionForeground); text-align: center; }

  /* ── Status badges ── */
  .badge-status { font-size: 9px; padding: 1px 4px; border-radius: 3px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; }
  .badge-sent { background: #6b6b00; color: #ffff80; }
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
  let selectedWwuid = null;
  let pendingFormatted = '';
  let searchQuery = '';

  // ── Tab switching ─────────────────────────────────────────────────────────

  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      activeTab = tab.dataset.tab;
      document.getElementById('searchBar').classList.toggle('visible', activeTab === 'all');
      renderList();
    });
  });

  document.getElementById('searchInput').addEventListener('input', (e) => {
    searchQuery = e.target.value.toLowerCase();
    renderList();
  });

  // ── Controls ──────────────────────────────────────────────────────────────

  document.getElementById('btnRefresh').addEventListener('click', () => refresh());
  document.getElementById('btnCompose').addEventListener('click', () => toggleCompose());
  document.getElementById('btnCancel').addEventListener('click', () => toggleCompose(false));
  document.getElementById('btnSend').addEventListener('click', () => sendWire());

  document.getElementById('listPane').addEventListener('click', (e) => {
    const row = e.target.closest('.wire-row');
    if (row && row.dataset.wwuid) selectWire(row.dataset.wwuid);
  });

  document.getElementById('detailPane').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-push]');
    if (btn) pushTo(pendingFormatted, btn.dataset.push);
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

  function currentList() {
    if (activeTab === 'inbox')  return inboxWires;
    if (activeTab === 'outbox') return outboxWires;
    // All tab with optional search
    if (!searchQuery) return allWires;
    return allWires.filter(w =>
      (w.subject || '').toLowerCase().includes(searchQuery) ||
      (w.from    || '').toLowerCase().includes(searchQuery) ||
      (w.to      || '').toLowerCase().includes(searchQuery) ||
      (w.type    || '').toLowerCase().includes(searchQuery) ||
      (w.body    || '').toLowerCase().includes(searchQuery)
    );
  }

  function renderList() {
    const pane = document.getElementById('listPane');
    const list = currentList();
    if (list.length === 0) {
      const msg = !flatAvailable
        ? 'telegraph/flat/ not found'
        : activeTab === 'inbox'  ? 'Inbox empty'
        : activeTab === 'outbox' ? 'No sent wires'
        : searchQuery            ? 'No matches'
        : 'No wires';
      pane.innerHTML = '<div class="empty-list">' + esc(msg) + '</div>';
      return;
    }
    pane.innerHTML = list.map(w => wireRow(w)).join('');
  }

  function wireRow(w) {
    const active = w.wwuid === selectedWwuid ? ' active' : '';
    const dateStr = w.date ? new Date(w.date).toLocaleDateString([], { month: 'short', day: 'numeric' }) : '';
    const statusBadge = '<span class="badge-status badge-' + esc(w.status || 'sent') + '">' + esc(w.status || '') + '</span>';
    return '<div class="wire-row' + active + '" data-wwuid="' + esc(w.wwuid) + '">'
      + '<div class="subject">' + esc(w.subject || w.filename || '—') + '</div>'
      + '<div class="meta">' + statusBadge + ' <span>' + esc(w.from || w.to || '') + '</span> <span>' + esc(dateStr) + '</span></div>'
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

    // Push bar
    html += '<div class="push-bar">'
      + '<button class="btn" data-push="copilot">→ Copilot</button>'
      + '<button class="btn btn-secondary" data-push="claude">→ Claude</button>'
      + '<button class="btn btn-secondary" data-push="codex">→ Codex</button>'
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
