import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { Wire, WireStorageService } from './WireStorageService';
import { generateWwuid } from './sessionPipeline/utils';
import { telegraphTimestamp, telegraphISOTimestamp, readRegistryAlias } from './TelegraphService';
import { getTelegraphDirs } from './TelegraphService';
import { PromptIndexService } from './PromptIndexService';

export class TelegraphPanel {
  static readonly viewType = 'wildwest.telegraphPanel';
  private static instance: TelegraphPanel | undefined;

  private readonly panel: vscode.WebviewPanel;
  private readonly wireStorage: WireStorageService;
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
    TelegraphPanel.instance = new TelegraphPanel(panel, exportPath, promptIndex);
  }

  private constructor(
    panel: vscode.WebviewPanel,
    private readonly exportPath: string,
    private readonly promptIndex?: PromptIndexService,
  ) {
    this.panel = panel;
    this.wireStorage = new WireStorageService(exportPath);

    this.panel.webview.html = this.buildHtml();
    this.sendWires();

    this.panel.webview.onDidReceiveMessage((msg) => this.onMessage(msg), null, this.disposables);
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
  }

  // ── Outbound to webview ───────────────────────────────────────────────────

  private sendWires(): void {
    const inbox = this.collectFileWires('inbox');
    const outbox = this.collectFileWires('outbox');
    this.panel.webview.postMessage({ type: 'wires', inbox, outbox });
  }

  private collectFileWires(section: 'inbox' | 'outbox'): Wire[] {
    const results: Wire[] = [];
    for (const telegraphDir of getTelegraphDirs()) {
      const dir = path.join(telegraphDir, section);
      if (!fs.existsSync(dir)) continue;
      for (const f of fs.readdirSync(dir)) {
        if (!f.endsWith('.json') || f.startsWith('.')) continue;
        try {
          const wire = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as Wire;
          results.push(wire);
        } catch { /* skip corrupt */ }
      }
    }
    // Sort newest first
    return results.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
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
        const scope = (msg['scope'] as string) ?? undefined;
        const results = this.promptIndex?.search(query, scope, 10, {
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
    const telegraphDir = path.join(wsPath, '.wildwest', 'telegraph');
    if (!fs.existsSync(telegraphDir)) {
      this.panel.webview.postMessage({ type: 'error', text: 'Telegraph directory not found.' });
      return;
    }

    const alias = readRegistryAlias(path.join(wsPath, '.wildwest'));
    const identity = vscode.workspace.getConfiguration('wildwest').get<string>('identity') ?? '';
    const roleMatch = identity.match(/^([A-Za-z]+)/);
    const role = roleMatch?.[1] ?? 'TM';
    const fromActor = alias ? `${role}(${alias})` : (identity || 'TM');

    const timestamp = telegraphTimestamp();
    const isoTimestamp = telegraphISOTimestamp();
    const fileName = `${timestamp}-to-${to}-from-${fromActor}--${subject}.json`;
    const wwuid = generateWwuid('wire', fromActor, to, isoTimestamp, subject);

    const wire: Wire = {
      schema_version: '1',
      wwuid,
      wwuid_type: 'wire',
      from: fromActor,
      to,
      type,
      date: isoTimestamp,
      subject,
      status: 'sent',
      body,
      filename: fileName,
    };

    const outboxDir = path.join(telegraphDir, 'outbox');
    fs.mkdirSync(outboxDir, { recursive: true });
    fs.writeFileSync(path.join(outboxDir, fileName), JSON.stringify(wire, null, 2), 'utf8');
    this.wireStorage.write(wire);

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
      vscode.window.showInformationMessage(`No terminals open — copied to clipboard.`);
      return;
    }

    // Sort: terminals matching the label float to top
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

  /* ── Main layout ── */
  .main { display: flex; flex: 1; overflow: hidden; }

  /* ── Wire list ── */
  .list-pane { width: 220px; flex-shrink: 0; border-right: 1px solid var(--vscode-panel-border); overflow-y: auto; display: flex; flex-direction: column; }
  .list-section { padding: 6px 8px 2px; font-size: 11px; font-weight: 600; color: var(--vscode-descriptionForeground); text-transform: uppercase; letter-spacing: 0.05em; }
  .wire-row { padding: 6px 10px; cursor: pointer; border-left: 2px solid transparent; }
  .wire-row:hover { background: var(--vscode-list-hoverBackground); }
  .wire-row.active { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); border-left-color: var(--vscode-focusBorder); }
  .wire-row .subject { font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .wire-row .meta { font-size: 10px; color: var(--vscode-descriptionForeground); margin-top: 2px; }
  .wire-row.active .meta { color: var(--vscode-list-activeSelectionForeground); opacity: 0.8; }
  .empty-list { padding: 12px 10px; font-size: 12px; color: var(--vscode-descriptionForeground); }

  /* ── Wire detail ── */
  .detail-pane { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 12px; }
  .detail-pane.empty-detail { align-items: center; justify-content: center; color: var(--vscode-descriptionForeground); font-size: 12px; }
  .wire-header table { width: 100%; border-collapse: collapse; font-size: 12px; }
  .wire-header td { padding: 3px 8px; }
  .wire-header td:first-child { font-weight: 600; color: var(--vscode-descriptionForeground); width: 70px; }
  .wire-body { font-size: 13px; line-height: 1.6; white-space: pre-wrap; word-break: break-word; }
  .push-bar { display: flex; gap: 8px; flex-wrap: wrap; }
  .push-bar .btn { font-size: 11px; padding: 3px 8px; }

  /* ── Compose drawer ── */
  .compose-drawer { border-top: 1px solid var(--vscode-panel-border); flex-shrink: 0; overflow: hidden; transition: max-height 0.2s ease; max-height: 0; }
  .compose-drawer.open { max-height: 280px; }
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
  let wires = { inbox: [], outbox: [] };
  let selectedWwuid = null;
  let pendingFormatted = '';

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

  window.addEventListener('message', ({ data }) => {
    if (data.type === 'wires') {
      wires = data;
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

  // ── Prompt autocomplete ──────────────────────────────────────────────────
  let promptSearchTimer = null;
  const cBody = document.getElementById('cBody');
  const promptDropdown = document.getElementById('promptDropdown');

  cBody.addEventListener('input', () => {
    clearTimeout(promptSearchTimer);
    const val = cBody.value;
    const lastLine = val.split('\\n').pop() || '';
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
      + '<div style="font-size:10px;color:var(--vscode-descriptionForeground)">' + esc(p.kind + ' · ' + p.tool + ' · ' + (p.scope_alias || p.recorder_scope) + ' · ' + p.last_used.slice(0,10)) + '</div>'
      + '</div>'
    ).join('');
    promptDropdown.style.display = 'block';
    promptDropdown._results = results;
    promptDropdown.querySelectorAll('.prompt-item').forEach(el => {
      el.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const r = results[parseInt(el.dataset.idx)];
        if (r) { cBody.value = r.content; promptDropdown.style.display = 'none'; }
      });
    });
  }

  function refresh() { vscode.postMessage({ type: 'refresh' }); }

  function renderList() {
    const pane = document.getElementById('listPane');
    let html = '';
    if (wires.inbox.length) {
      html += '<div class="list-section">Inbox (' + wires.inbox.length + ')</div>';
      html += wires.inbox.map(w => wireRow(w)).join('');
    }
    if (wires.outbox.length) {
      html += '<div class="list-section">Outbox (' + wires.outbox.length + ')</div>';
      html += wires.outbox.map(w => wireRow(w)).join('');
    }
    if (!wires.inbox.length && !wires.outbox.length) {
      html = '<div class="empty-list">No wires</div>';
    }
    pane.innerHTML = html;
  }

  function wireRow(w) {
    const active = w.wwuid === selectedWwuid ? ' active' : '';
    const dateStr = w.date ? new Date(w.date).toLocaleDateString([], { month: 'short', day: 'numeric' }) : '';
    return '<div class="wire-row' + active + '" data-wwuid="' + esc(w.wwuid) + '">'
      + '<div class="subject">' + esc(w.subject || w.filename || '—') + '</div>'
      + '<div class="meta">' + esc(w.from || '') + ' · ' + dateStr + '</div>'
      + '</div>';
  }

  function selectWire(wwuid) {
    selectedWwuid = wwuid;
    renderList();
    renderDetail(wwuid);
  }

  function renderDetail(wwuid) {
    const all = [...(wires.inbox || []), ...(wires.outbox || [])];
    const w = all.find(x => x.wwuid === wwuid);
    const pane = document.getElementById('detailPane');
    if (!w) {
      pane.className = 'detail-pane empty-detail';
      pane.innerHTML = '<span>Select a wire to read</span>';
      return;
    }
    pane.className = 'detail-pane';
    const dateStr = w.date ? new Date(w.date).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
    pendingFormatted = '📬 [from ' + (w.from||'') + ' | ' + (w.subject||'') + ' | ' + (w.date||'') + ']\\n\\n' + (w.body||'');
    pane.innerHTML =
      '<div class="wire-header"><table>'
      + row('From', w.from) + row('To', w.to) + row('Date', dateStr)
      + row('Subject', w.subject) + row('Type', w.type) + row('Status', w.status)
      + '</table></div>'
      + '<div class="wire-body">' + esc(w.body || '') + '</div>'
      + '<div class="push-bar">'
      + '<button class="btn" data-push="copilot">→ Copilot</button>'
      + '<button class="btn btn-secondary" data-push="claude">→ Claude</button>'
      + '<button class="btn btn-secondary" data-push="codex">→ Codex</button>'
      + '</div>';
  }

  function row(label, val) {
    return '<tr><td>' + esc(label) + '</td><td>' + esc(val || '—') + '</td></tr>';
  }

  function pushTo(formatted, target) {
    if (target === 'copilot') {
      vscode.postMessage({ type: 'pushToCopilot', formatted });
    } else {
      vscode.postMessage({ type: 'pushToTerminal', formatted, label: target });
    }
  }

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
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
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
