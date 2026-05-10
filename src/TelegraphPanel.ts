import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { Memo, MemoStorageService } from './MemoStorageService';
import { generateWwuid } from './sessionPipeline/utils';
import { telegraphTimestamp, telegraphISOTimestamp, readRegistryAlias } from './TelegraphService';
import { getTelegraphDirs } from './TelegraphService';

export class TelegraphPanel {
  static readonly viewType = 'wildwest.telegraphPanel';
  private static instance: TelegraphPanel | undefined;

  private readonly panel: vscode.WebviewPanel;
  private readonly memoStorage: MemoStorageService;
  private disposables: vscode.Disposable[] = [];

  static open(exportPath: string): void {
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
    TelegraphPanel.instance = new TelegraphPanel(panel, exportPath);
  }

  private constructor(panel: vscode.WebviewPanel, private readonly exportPath: string) {
    this.panel = panel;
    this.memoStorage = new MemoStorageService(exportPath);

    this.panel.webview.html = this.buildHtml();
    this.sendMemos();

    this.panel.webview.onDidReceiveMessage((msg) => this.onMessage(msg), null, this.disposables);
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
  }

  // ── Outbound to webview ───────────────────────────────────────────────────

  private sendMemos(): void {
    const inbox = this.collectFileMemos('inbox');
    const outbox = this.collectFileMemos('outbox');
    this.panel.webview.postMessage({ type: 'memos', inbox, outbox });
  }

  private collectFileMemos(section: 'inbox' | 'outbox'): Memo[] {
    const results: Memo[] = [];
    for (const telegraphDir of getTelegraphDirs()) {
      const dir = path.join(telegraphDir, section);
      if (!fs.existsSync(dir)) continue;
      for (const f of fs.readdirSync(dir)) {
        if (!f.endsWith('.json') || f.startsWith('.')) continue;
        try {
          const memo = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as Memo;
          results.push(memo);
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
        this.sendMemos();
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
    }
  }

  private async handleSend(msg: Record<string, unknown>): Promise<void> {
    const to = (msg['to'] as string ?? '').trim();
    const type = (msg['memoType'] as string ?? 'status-update').trim();
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
    const wwuid = generateWwuid('memo', fromActor, to, isoTimestamp, subject);

    const memo: Memo = {
      schema_version: '1',
      wwuid,
      wwuid_type: 'memo',
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
    fs.writeFileSync(path.join(outboxDir, fileName), JSON.stringify(memo, null, 2), 'utf8');
    this.memoStorage.write(memo);

    this.panel.webview.postMessage({ type: 'sent', memo });
    this.sendMemos();
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

  /* ── Memo list ── */
  .list-pane { width: 220px; flex-shrink: 0; border-right: 1px solid var(--vscode-panel-border); overflow-y: auto; display: flex; flex-direction: column; }
  .list-section { padding: 6px 8px 2px; font-size: 11px; font-weight: 600; color: var(--vscode-descriptionForeground); text-transform: uppercase; letter-spacing: 0.05em; }
  .memo-row { padding: 6px 10px; cursor: pointer; border-left: 2px solid transparent; }
  .memo-row:hover { background: var(--vscode-list-hoverBackground); }
  .memo-row.active { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); border-left-color: var(--vscode-focusBorder); }
  .memo-row .subject { font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .memo-row .meta { font-size: 10px; color: var(--vscode-descriptionForeground); margin-top: 2px; }
  .memo-row.active .meta { color: var(--vscode-list-activeSelectionForeground); opacity: 0.8; }
  .empty-list { padding: 12px 10px; font-size: 12px; color: var(--vscode-descriptionForeground); }

  /* ── Memo detail ── */
  .detail-pane { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 12px; }
  .detail-pane.empty-detail { align-items: center; justify-content: center; color: var(--vscode-descriptionForeground); font-size: 12px; }
  .memo-header table { width: 100%; border-collapse: collapse; font-size: 12px; }
  .memo-header td { padding: 3px 8px; }
  .memo-header td:first-child { font-weight: 600; color: var(--vscode-descriptionForeground); width: 70px; }
  .memo-body { font-size: 13px; line-height: 1.6; white-space: pre-wrap; word-break: break-word; }
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
    <span>Select a memo to read</span>
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
    <textarea class="compose-body" id="cBody" placeholder="Memo body…"></textarea>
    <div class="compose-footer">
      <span class="error-bar" id="composeError"></span>
      <button class="btn btn-secondary" id="btnCancel">Cancel</button>
      <button class="btn" id="btnSend">Send</button>
    </div>
  </div>
</div>

<script>
  const vscode = acquireVsCodeApi();
  let memos = { inbox: [], outbox: [] };
  let selectedWwuid = null;
  let pendingFormatted = '';

  document.getElementById('btnRefresh').addEventListener('click', () => refresh());
  document.getElementById('btnCompose').addEventListener('click', () => toggleCompose());
  document.getElementById('btnCancel').addEventListener('click', () => toggleCompose(false));
  document.getElementById('btnSend').addEventListener('click', () => sendMemo());

  document.getElementById('listPane').addEventListener('click', (e) => {
    const row = e.target.closest('.memo-row');
    if (row && row.dataset.wwuid) selectMemo(row.dataset.wwuid);
  });

  document.getElementById('detailPane').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-push]');
    if (btn) pushTo(pendingFormatted, btn.dataset.push);
  });

  window.addEventListener('message', ({ data }) => {
    if (data.type === 'memos') {
      memos = data;
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
  });

  function refresh() { vscode.postMessage({ type: 'refresh' }); }

  function renderList() {
    const pane = document.getElementById('listPane');
    let html = '';
    if (memos.inbox.length) {
      html += '<div class="list-section">Inbox (' + memos.inbox.length + ')</div>';
      html += memos.inbox.map(m => memoRow(m)).join('');
    }
    if (memos.outbox.length) {
      html += '<div class="list-section">Outbox (' + memos.outbox.length + ')</div>';
      html += memos.outbox.map(m => memoRow(m)).join('');
    }
    if (!memos.inbox.length && !memos.outbox.length) {
      html = '<div class="empty-list">No memos</div>';
    }
    pane.innerHTML = html;
  }

  function memoRow(m) {
    const active = m.wwuid === selectedWwuid ? ' active' : '';
    const dateStr = m.date ? new Date(m.date).toLocaleDateString([], { month: 'short', day: 'numeric' }) : '';
    return '<div class="memo-row' + active + '" data-wwuid="' + esc(m.wwuid) + '">'
      + '<div class="subject">' + esc(m.subject || m.filename || '—') + '</div>'
      + '<div class="meta">' + esc(m.from || '') + ' · ' + dateStr + '</div>'
      + '</div>';
  }

  function selectMemo(wwuid) {
    selectedWwuid = wwuid;
    renderList();
    renderDetail(wwuid);
  }

  function renderDetail(wwuid) {
    const all = [...(memos.inbox || []), ...(memos.outbox || [])];
    const m = all.find(x => x.wwuid === wwuid);
    const pane = document.getElementById('detailPane');
    if (!m) {
      pane.className = 'detail-pane empty-detail';
      pane.innerHTML = '<span>Select a memo to read</span>';
      return;
    }
    pane.className = 'detail-pane';
    const dateStr = m.date ? new Date(m.date).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
    pendingFormatted = '📬 [from ' + (m.from||'') + ' | ' + (m.subject||'') + ' | ' + (m.date||'') + ']\\n\\n' + (m.body||'');
    pane.innerHTML =
      '<div class="memo-header"><table>'
      + row('From', m.from) + row('To', m.to) + row('Date', dateStr)
      + row('Subject', m.subject) + row('Type', m.type) + row('Status', m.status)
      + '</table></div>'
      + '<div class="memo-body">' + esc(m.body || '') + '</div>'
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

  function sendMemo() {
    document.getElementById('composeError').textContent = '';
    vscode.postMessage({
      type: 'send',
      to: document.getElementById('cTo').value,
      memoType: document.getElementById('cType').value,
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
