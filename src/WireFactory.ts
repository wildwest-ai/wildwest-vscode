import * as fs from 'fs';
import * as path from 'path';
import { generateWwuid } from './sessionPipeline/utils';
import { telegraphTimestamp, telegraphISOTimestamp } from './TelegraphService';

// ── Schema v2 types ───────────────────────────────────────────────────────────

export interface StatusTransition {
  status: string;
  timestamp: string;
  instances?: number;
  repos?: string[];
}

/**
 * Valid wire lifecycle statuses.
 * draft/pending are LOCAL only — never written to territory SSOT.
 * sent/received/read/archived live in territory ~/wildwest/telegraph/flat/.
 */
export type WireStatus = 'draft' | 'pending' | 'sent' | 'received' | 'read' | 'archived';

export interface FlatWire {
  schema_version: '2';
  wwuid: string;
  wwuid_type: 'wire';
  from?: string;
  to?: string;
  type: string;
  date: string;
  subject: string;
  status: string;
  body: string;
  filename: string;
  // Lifecycle timestamps (set by HeartbeatMonitor)
  sent_at?: string;               // when operator dispatched to territory
  received_at?: string;           // when recipient HB confirmed arrival
  read_at?: string;               // when recipient marked read
  /** @deprecated use received_at */ delivered_at?: string;
  // Per-actor view overlay — never drives territory status alone
  sender_archived_at?: string;    // sender dismissed from Outbox view
  recipient_archived_at?: string; // recipient dismissed from Inbox view
  re?: string;
  original_wire?: string;
  status_transitions?: StatusTransition[];
}

export interface CreateWireParams {
  from: string;
  to: string;
  type: string;
  subject: string;
  body: string;
  status?: string;
  re?: string;
  original_wire?: string;
}

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * Build a schema v2 FlatWire ready to drop into ~/wildwest/telegraph/flat/.
 * Generates wwuid, filename, date, and seeds status_transitions with the initial status.
 * Default status is 'draft' — callers that immediately dispatch should pass status: 'sent'.
 */
export function createFlatWire(params: CreateWireParams): FlatWire {
  const isoNow = telegraphISOTimestamp();
  const ts = telegraphTimestamp();
  const filename = `${ts}-to-${params.to}-from-${params.from}--${params.subject}.json`;
  const wwuid = generateWwuid('wire', params.from, params.to, isoNow, params.subject);
  const status = params.status ?? 'draft';

  const wire: FlatWire = {
    schema_version: '2',
    wwuid,
    wwuid_type: 'wire',
    from: params.from,
    to: params.to,
    type: params.type,
    date: isoNow,
    subject: params.subject,
    status,
    body: params.body,
    filename,
    status_transitions: [
      {
        status,
        timestamp: isoNow,
        instances: 1,
        repos: ['vscode'],
      },
    ],
  };

  if (params.re)            wire.re = params.re;
  if (params.original_wire) wire.original_wire = params.original_wire;

  return wire;
}

// ── I/O helpers ───────────────────────────────────────────────────────────────

/** Write a FlatWire to territory flat/ directory by wwuid. */
export function writeFlatWire(wire: FlatWire, flatDir: string): void {
  fs.mkdirSync(flatDir, { recursive: true });
  fs.writeFileSync(
    path.join(flatDir, `${wire.wwuid}.json`),
    JSON.stringify(wire, null, 2),
    'utf8',
  );
}

/**
 * Write a draft wire to the LOCAL workspace flat/ directory.
 * Draft wires are local-only — never written to territory until sent.
 * @param wire    FlatWire with status 'draft'
 * @param wsPath  Workspace root path (parent of .wildwest/)
 */
export function writeDraftWire(wire: FlatWire, wsPath: string): void {
  const localFlatDir = path.join(wsPath, '.wildwest', 'telegraph', 'flat');
  fs.mkdirSync(localFlatDir, { recursive: true });
  fs.writeFileSync(
    path.join(localFlatDir, `${wire.wwuid}.json`),
    JSON.stringify(wire, null, 2),
    'utf8',
  );
}

/** Parse to/from from wire filename when JSON fields are absent. */
const FILENAME_RE = /^\d{8}-\d{4}Z-to-(.+?)-from-(.+?)--.+\.(md|json)$/;

export function parseFilenameActors(filename: string): { to?: string; from?: string } {
  const m = path.basename(filename).match(FILENAME_RE);
  if (!m) return {};
  return { to: m[1], from: m[2] };
}
