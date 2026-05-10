import * as fs from 'fs';
import * as path from 'path';
import {
  BoardInput,
  BoardOutput,
  BranchSummary,
  InboxInput,
  InboxOutput,
  MCPScopeContext,
  WireSummary,
  StatusOutput,
  TelegraphCheckOutput,
} from './types';

// ── wildwest_status ─────────────────────────────────────────────────────────

export function toolStatus(ctx: MCPScopeContext): StatusOutput {
  const regPath = path.join(ctx.rootPath, '.wildwest', 'registry.json');
  let alias = '';
  let wwuid = '';
  try {
    const reg = JSON.parse(fs.readFileSync(regPath, 'utf8'));
    alias = reg.alias ?? '';
    wwuid = reg.wwuid ?? '';
  } catch { /* registry unreadable */ }

  const beatPath = path.join(ctx.rootPath, '.wildwest', 'telegraph', '.last-beat');
  const lastBeat = fs.existsSync(beatPath) ? fs.readFileSync(beatPath, 'utf8').trim() : 'unknown';

  // Derive liveness: if last beat is within 2x the default interval (10 min), alive
  let state = 'unknown';
  try {
    const beatTime = new Date(lastBeat).getTime();
    const age = Date.now() - beatTime;
    state = age < 10 * 60 * 1000 ? 'alive' : 'stale';
  } catch { /* unparseable */ }

  return { alias, scope: ctx.scope, wwuid, lastBeat, state };
}

// ── wildwest_inbox ──────────────────────────────────────────────────────────

export function toolInbox(ctx: MCPScopeContext, input: InboxInput): InboxOutput {
  const limit = input.limit ?? 20;
  const inboxDir = path.join(ctx.rootPath, '.wildwest', 'telegraph', 'inbox');

  if (!fs.existsSync(inboxDir)) {
    return { wires: [], total: 0 };
  }

  const files = fs
    .readdirSync(inboxDir)
    .filter((f) => (f.endsWith('.json') || f.endsWith('.md')) && !f.startsWith('.') && !f.startsWith('!') && f !== 'history')
    .sort()
    .slice(0, limit);

  const wires: WireSummary[] = files.map((filename) => {
    const filePath = path.join(inboxDir, filename);
    return parseWireSummary(filePath, filename);
  });

  return { wires, total: wires.length };
}

// ── wildwest_board ──────────────────────────────────────────────────────────

export function toolBoard(ctx: MCPScopeContext, input: BoardInput): BoardOutput {
  const boardDir = path.join(ctx.rootPath, '.wildwest', 'board', 'branches');

  if (!fs.existsSync(boardDir)) {
    return { branches: [] };
  }

  const filterState = input.state ?? 'open';
  const files = fs.readdirSync(boardDir).filter((f) => f.endsWith('.json'));

  const branches: BranchSummary[] = [];
  for (const file of files.sort()) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(boardDir, file), 'utf8'));
      const branchState: string = data.state ?? 'unknown';
      if (filterState === 'open' && branchState !== 'open') continue;
      branches.push({
        branch: data.branch ?? file.replace('.json', ''),
        state: branchState,
        identity: data.identity ?? data.actor ?? '',
      });
    } catch { /* skip unreadable */ }
  }

  return { branches };
}

// ── wildwest_telegraph_check ────────────────────────────────────────────────

export function toolTelegraphCheck(ctx: MCPScopeContext): TelegraphCheckOutput {
  const telegraphDir = path.join(ctx.rootPath, '.wildwest', 'telegraph');

  const count = (dir: string, predicate: (f: string) => boolean): number => {
    if (!fs.existsSync(dir)) return 0;
    try {
      return fs.readdirSync(dir).filter(predicate).length;
    } catch { return 0; }
  };

  const inboxDir = path.join(telegraphDir, 'inbox');
  const outboxDir = path.join(telegraphDir, 'outbox');
  const historyDir = path.join(telegraphDir, 'history');
  const isWire = (f: string) => (f.endsWith('.json') || f.endsWith('.md')) && !f.startsWith('.');

  return {
    inbox: count(inboxDir, (f) => isWire(f) && !f.startsWith('!')),
    outbox: count(outboxDir, (f) => isWire(f) && !f.startsWith('!')),
    history: count(historyDir, isWire),
    deadLetter: count(inboxDir, (f) => f.startsWith('!')) +
                count(outboxDir, (f) => f.startsWith('!')),
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function parseWireSummary(filePath: string, filename: string): WireSummary {
  let subject = '';
  let from = '';
  let date = '';

  try {
    const content = fs.readFileSync(filePath, 'utf8');
    if (filename.endsWith('.json')) {
      const wire = JSON.parse(content) as Record<string, string>;
      subject = wire['subject'] ?? '';
      from = wire['from'] ?? '';
      date = wire['date'] ?? '';
    } else {
      const subjectMatch = content.match(/^subject:\s*(.+)$/m);
      const fromMatch = content.match(/^from:\s*(.+)$/m);
      const dateMatch = content.match(/^date:\s*(.+)$/m);
      subject = subjectMatch?.[1]?.trim() ?? '';
      from = fromMatch?.[1]?.trim() ?? '';
      date = dateMatch?.[1]?.trim() ?? '';
    }
  } catch { /* use defaults */ }

  if (!subject) {
    const parts = filename.replace(/\.(json|md)$/, '').split('--');
    subject = parts.length > 1 ? parts[parts.length - 1].replace(/-/g, ' ') : filename;
  }

  return { filename, subject, from, date };
}
