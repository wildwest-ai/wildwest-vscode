import * as fs from 'fs';
import * as path from 'path';
import {
  applyStatusUpdate,
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
  RetryWireInput,
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
  const flatDir = path.join(ctx.rootPath, '.wildwest', 'telegraph', 'flat');

  if (!fs.existsSync(flatDir)) {
    return { wires: [], total: 0 };
  }

  const files = fs
    .readdirSync(flatDir)
    .filter((f) => (f.endsWith('.json') || f.endsWith('.md')) && !f.startsWith('.') && !f.startsWith('!'))
    .sort()
    .slice(0, limit);

  const wires: WireSummary[] = files.map((filename) => {
    const filePath = path.join(flatDir, filename);
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

  const flatDir = path.join(telegraphDir, 'flat');
  const outboxDir = path.join(telegraphDir, 'outbox');
  const historyDir = path.join(outboxDir, 'history');
  const isWire = (f: string) => (f.endsWith('.json') || f.endsWith('.md')) && !f.startsWith('.');

  return {
    inbox: count(flatDir, (f) => isWire(f) && !f.startsWith('!')),
    outbox: count(outboxDir, (f) => isWire(f) && !f.startsWith('!')),
    history: count(historyDir, isWire),
    deadLetter: count(outboxDir, (f) => f.startsWith('!')),
  };
}

export function toolDraftWire(ctx: MCPScopeContext, input: DraftWireInput): WireWriteOutput {
  // Validate addressing format
  const fromValidation = validateAddress(input.from);
  if (!fromValidation.valid) {
    throw new Error(`Invalid 'from' address: ${fromValidation.error}`);
  }
  const toValidation = validateAddress(input.to);
  if (!toValidation.valid) {
    throw new Error(`Invalid 'to' address: ${toValidation.error}`);
  }

  const fromAlias = readRegistryAlias(path.join(ctx.rootPath, '.wildwest'));
  if (!fromAlias) {
    throw new Error('Missing registry alias in .wildwest/registry.json');
  }

  const wire = createFlatWire({
    from: input.from,
    to: input.to,
    type: input.type ?? 'status-update',
    subject: normalizeWireSubject(input.subject),
    body: input.body,
    status: 'draft',
    re: input.re,
    transitionContext: transitionContext(ctx, fromAlias, 'wwmcp.draft-wire'),
  });

  const draftRoot = resolveAliasToLocalRoot(input.from, ctx) ?? ctx.localRoot;
  writeDraftWire(wire, draftRoot);
  const localFlatDir = path.join(draftRoot, '.wildwest', 'telegraph', 'flat');
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
    path: path.join(draftRoot, '.wildwest', 'telegraph', 'flat', `${wire.wwuid}.json`),
  };
}

export function toolSendWire(ctx: MCPScopeContext, input: SendWireInput): WireWriteOutput {
  // Validate addressing format
  const fromValidation = validateAddress(input.from);
  if (!fromValidation.valid) {
    throw new Error(`Invalid 'from' address: ${fromValidation.error}`);
  }
  const toValidation = validateAddress(input.to);
  if (!toValidation.valid) {
    throw new Error(`Invalid 'to' address: ${toValidation.error}`);
  }

  const fromAlias = readRegistryAlias(path.join(ctx.rootPath, '.wildwest'));
  if (!fromAlias) {
    throw new Error('Missing registry alias in .wildwest/registry.json');
  }

  const wire = createFlatWire({
    from: input.from,
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
  fs.writeFileSync(path.join(localOutboxDir, wire.filename), JSON.stringify(wire, null, 2), 'utf8');

  return {
    wwuid: wire.wwuid,
    filename: wire.filename,
    status: wire.status,
    date: wire.date,
    path: path.join(territoryFlatDir, `${wire.wwuid}.json`),
  };
}

export function toolRetryWire(ctx: MCPScopeContext, input: RetryWireInput): WireWriteOutput {
  const wwuid = input.wwuid?.trim();
  if (!wwuid) {
    throw new Error('wwuid is required');
  }

  for (const rootPath of recoveryRoots(ctx.rootPath)) {
    const outboxDir = path.join(rootPath, '.wildwest', 'telegraph', 'outbox');
    const failedPath = path.join(outboxDir, `!${wwuid}.json`);
    const restoredPath = path.join(outboxDir, `${wwuid}.json`);
    if (!fs.existsSync(failedPath)) continue;

    const wire = JSON.parse(fs.readFileSync(failedPath, 'utf8')) as Record<string, unknown>;
    for (const key of ['to', 'from', 'subject', 'type']) {
      if (typeof wire[key] === 'string') {
        wire[key] = (wire[key] as string).replace(/\(!\)$/u, '');
      }
    }
    wire['status'] = 'pending';
    delete wire['failure'];
    delete wire['failed_at'];
    const alias = readRegistryAlias(path.join(rootPath, '.wildwest')) ?? '';
    applyStatusUpdate(
      wire as unknown as Parameters<typeof applyStatusUpdate>[0],
      'pending',
      { status: 'pending' },
      transitionContext({ ...ctx, rootPath }, alias, 'wwmcp.retry-wire'),
    );

    fs.writeFileSync(restoredPath, JSON.stringify(wire, null, 2), 'utf8');
    fs.unlinkSync(failedPath);

    return {
      wwuid,
      filename: (wire['filename'] as string | undefined) ?? `${wwuid}.json`,
      status: 'pending',
      date: (wire['date'] as string | undefined) ?? new Date().toISOString(),
      path: restoredPath,
    };
  }

  throw new Error(`Failed wire not found: ${wwuid}`);
}

/**
 * Validate addressing format per wildwest spec:
 * - County roles (CD, S, RA, aCD, DS): Role(dyad)[scope] or Role[scope]
 * - Town roles (TM, DM, HG): Role[town] or Role[*pattern] — no dyad parens allowed
 * - Territory roles (G, RA): Role[territory]
 * Returns { valid: boolean, error?: string }
 */
function validateAddress(address: string): { valid: boolean; error?: string } {
  const countyRoles = ['CD', 'S', 'RA', 'aCD', 'DS'];
  const townRoles = ['TM', 'DM', 'HG'];
  const territoryRoles = ['G', 'RA'];

  // Parse: Role[(dyad)][scope]
  const match = address.match(/^([A-Za-z]+)(?:\(([^)]+)\))?\[([^\]]+)\]$/);
  if (!match) {
    return { valid: false, error: `Invalid address format: '${address}'. Expected Role[(dyad)][scope] or Role[scope]` };
  }

  const [, role, dyad, scope] = match;

  // Check role + dyad + scope rules
  if (countyRoles.includes(role)) {
    // County roles: dyad optional, scope required
    if (!scope || scope.length === 0) {
      return { valid: false, error: `County role '${role}' requires scope: '${role}${dyad ? `(${dyad})` : ''}[scope]'` };
    }
    return { valid: true };
  } else if (townRoles.includes(role)) {
    // Town roles: dyad NOT allowed, scope required
    if (dyad) {
      return { valid: false, error: `Town role '${role}' does not use dyad parens: use '${role}[${scope}]' not '${role}(${dyad})[${scope}]'` };
    }
    if (!scope || scope.length === 0) {
      return { valid: false, error: `Town role '${role}' requires scope: '${role}[town]' or '${role}[*pattern]'` };
    }
    return { valid: true };
  } else if (territoryRoles.includes(role)) {
    // Territory roles: dyad optional, scope required
    if (!scope || scope.length === 0) {
      return { valid: false, error: `Territory role '${role}' requires scope: '${role}${dyad ? `(${dyad})` : ''}[territory]'` };
    }
    return { valid: true };
  } else {
    return { valid: false, error: `Unknown role: '${role}'` };
  }
}

/**
 * Given a Role[alias] address, walk the territory to find the local root for that alias.
 * Searches: territory root, each county, each town under each county.
 * Returns the matching root path or null if not found.
 */
function resolveAliasToLocalRoot(address: string, ctx: MCPScopeContext): string | null {
  const alias = address.match(/\[([^\]]+)\]/)?.[1];
  if (!alias) return null;

  const check = (dir: string): string | null => {
    try {
      const reg = JSON.parse(fs.readFileSync(path.join(dir, '.wildwest', 'registry.json'), 'utf8')) as Record<string, unknown>;
      if (reg['alias'] === alias) return dir;
    } catch { /* skip */ }
    return null;
  };

  // Check territory root itself
  const atTerritory = check(ctx.worldRoot);
  if (atTerritory) return atTerritory;

  // Walk counties
  const countiesPath = path.join(ctx.worldRoot, ctx.countiesDir);
  let counties: string[] = [];
  try { counties = fs.readdirSync(countiesPath); } catch { /* skip */ }

  for (const county of counties) {
    const countyPath = path.join(countiesPath, county);
    const atCounty = check(countyPath);
    if (atCounty) return atCounty;

    // Walk towns within county
    let towns: string[] = [];
    try { towns = fs.readdirSync(countyPath); } catch { /* skip */ }
    for (const town of towns) {
      const townPath = path.join(countyPath, town);
      const atTown = check(townPath);
      if (atTown) return atTown;
    }
  }

  return null;
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

function recoveryRoots(rootPath: string): string[] {
  const roots = new Set<string>();
  roots.add(rootPath);
  const countyRoot = findAncestorScopeRoot(rootPath, 'county');
  if (countyRoot) roots.add(countyRoot);
  return [...roots];
}

function findAncestorScopeRoot(startPath: string, scope: string): string | null {
  let current = startPath;
  const fsRoot = path.parse(current).root;
  while (current && current !== fsRoot) {
    try {
      const reg = JSON.parse(
        fs.readFileSync(path.join(current, '.wildwest', 'registry.json'), 'utf8'),
      ) as Record<string, unknown>;
      if (reg['scope'] === scope) return current;
    } catch { /* keep walking */ }
    current = path.dirname(current);
  }
  return null;
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
