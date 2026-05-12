import * as fs from 'fs';
import * as path from 'path';
import {
  createFlatWire,
  createWireStatusUpdatePacket,
  writeDraftWire,
  writeFlatWire,
  writeWireUpdatePacket,
} from '../WireFactory';
import {
  readRegistryAlias,
} from '../TelegraphService';
import {
  BoardInput,
  BoardOutput,
  BranchSummary,
  DraftWireInput,
  InboxInput,
  InboxOutput,
  MCPScopeContext,
  SendWireInput,
  TelegraphCheckOutput,
  WireSummary,
  StatusOutput,
  WireWriteOutput,
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

export function toolDraftWire(ctx: MCPScopeContext, input: DraftWireInput): WireWriteOutput {
  const fromAlias = readRegistryAlias(path.join(ctx.rootPath, '.wildwest'));
  if (!fromAlias) {
    throw new Error('Missing registry alias in .wildwest/registry.json');
  }
  const from = senderAddress(ctx, fromAlias);

  const wire = createFlatWire({
    from,
    to: input.to,
    type: input.type ?? 'status-update',
    subject: normalizeWireSubject(input.subject),
    body: input.body,
    status: 'draft',
    re: input.re,
    transitionContext: transitionContext(ctx, fromAlias, 'wwmcp.draft-wire'),
  });

  writeDraftWire(wire, ctx.rootPath);
  const localFlatDir = path.join(ctx.rootPath, '.wildwest', 'telegraph', 'flat');
  const transition = wire.status_transitions?.[wire.status_transitions.length - 1];
  if (transition) {
    writeWireUpdatePacket(
      createWireStatusUpdatePacket(wire, { status: wire.status }, transition, transitionContext(ctx, fromAlias, 'wwmcp.draft-wire')),
      localFlatDir,
    );
  }

  return {
    wwuid: wire.wwuid,
    filename: wire.filename,
    status: wire.status,
    date: wire.date,
    path: path.join(ctx.rootPath, '.wildwest', 'telegraph', 'flat', `${wire.wwuid}.json`),
  };
}

export function toolSendWire(ctx: MCPScopeContext, input: SendWireInput): WireWriteOutput {
  const fromAlias = readRegistryAlias(path.join(ctx.rootPath, '.wildwest'));
  if (!fromAlias) {
    throw new Error('Missing registry alias in .wildwest/registry.json');
  }
  const from = senderAddress(ctx, fromAlias);

  const wire = createFlatWire({
    from,
    to: input.to,
    type: input.type ?? 'status-update',
    subject: normalizeWireSubject(input.subject),
    body: input.body,
    status: 'sent',
    re: input.re,
    transitionContext: transitionContext(ctx, fromAlias, 'wwmcp.send-wire'),
  });

  const territoryFlatDir = path.join(ctx.worldRoot, 'telegraph', 'flat');
  writeFlatWire(wire, territoryFlatDir);
  const transition = wire.status_transitions?.[wire.status_transitions.length - 1];
  if (transition) {
    writeWireUpdatePacket(
      createWireStatusUpdatePacket(wire, { status: wire.status }, transition, transitionContext(ctx, fromAlias, 'wwmcp.send-wire')),
      territoryFlatDir,
    );
  }

  const localOutboxDir = path.join(ctx.rootPath, '.wildwest', 'telegraph', 'outbox');
  fs.mkdirSync(localOutboxDir, { recursive: true });
  fs.writeFileSync(path.join(localOutboxDir, `${wire.wwuid}.json`), JSON.stringify(wire, null, 2), 'utf8');

  return {
    wwuid: wire.wwuid,
    filename: wire.filename,
    status: wire.status,
    date: wire.date,
    path: path.join(territoryFlatDir, `${wire.wwuid}.json`),
  };
}

function senderAddress(ctx: MCPScopeContext, alias: string): string {
  const role = ctx.identity?.match(/^([A-Za-z]+)/)?.[1] ?? defaultRoleForScope(ctx.scope);
  return `${role}[${alias}]`;
}

function defaultRoleForScope(scope: MCPScopeContext['scope']): string {
  if (scope === 'county') return 'CD';
  if (scope === 'territory') return 'RA';
  return 'TM';
}

function transitionContext(ctx: MCPScopeContext, alias: string, source: string) {
  return {
    by: ctx.identity || senderAddress(ctx, alias),
    scope: ctx.scope,
    alias,
    tool: 'wwmcp',
    source,
  };
}

function normalizeWireSubject(subject: string): string {
  const normalized = subject
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (!normalized) {
    throw new Error('Subject must contain at least one alphanumeric character');
  }

  return normalized;
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
