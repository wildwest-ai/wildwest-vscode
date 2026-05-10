/**
 * DeliveryReceipts — compute delivery status per outbound wire.
 *
 * Status lifecycle:
 *   pending      outbox/*.md (queued, not yet delivered)
 *   failed       outbox/!*.md (permanent delivery failure)
 *   delivered    outbox/history/*.md (delivered, no ack yet)
 *   acknowledged outbox/history/*.md + inbox(/history)/ack-done--<subject>
 *   blocked      outbox/history/*.md + inbox(/history)/ack-blocked--<subject>
 *
 * No vscode dependency — pure fs/path so it can be unit-tested without mocks.
 */

import * as fs from 'fs';
import * as path from 'path';

export type WireStatus = 'pending' | 'delivered' | 'acknowledged' | 'failed' | 'blocked';

export interface DeliveryReceipt {
  filename: string;     // canonical wire filename (no ! prefix)
  subject: string;      // extracted from filename (last --<subject> segment)
  status: WireStatus;
  filePath: string;     // absolute path to the file on disk
  deliveredAt?: string; // ISO timestamp from delivered_at frontmatter field
}

// Matches standard wire filenames: YYYYMMDD-HHMMz-to-<to>-from-<from>--<subject>.md
const WIRE_FILENAME_RE = /^(?:\d{8}-\d{4}Z-)?to-.+-from-.+--(.+)\.md$/;

export function extractSubject(filename: string): string | null {
  const bare = filename.startsWith('!') ? filename.slice(1) : filename;
  const m = bare.match(WIRE_FILENAME_RE);
  return m ? m[1] : null;
}

export function statusIcon(status: WireStatus): string {
  switch (status) {
    case 'pending':      return '○';
    case 'delivered':    return '✓';
    case 'acknowledged': return '✓✓';
    case 'failed':       return '✗';
    case 'blocked':      return '⚠';
  }
}

function listMdFiles(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.md') && !f.startsWith('.') && f !== '.gitkeep')
      .sort();
  } catch {
    return [];
  }
}

function readDeliveredAt(filePath: string): string | undefined {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const m = content.match(/^delivered_at:\s*(.+)$/m);
    return m ? m[1].trim() : undefined;
  } catch {
    return undefined;
  }
}

function findAckStatus(
  telegraphDir: string,
  subject: string,
): 'acknowledged' | 'blocked' | null {
  const searchDirs = [
    path.join(telegraphDir, 'inbox'),
    path.join(telegraphDir, 'inbox', 'history'),
  ];
  for (const dir of searchDirs) {
    try {
      const files = fs.readdirSync(dir);
      if (files.some((f) => f.includes(`--ack-done--${subject}.md`))) return 'acknowledged';
      if (files.some((f) => f.includes(`--ack-blocked--${subject}.md`))) return 'blocked';
    } catch {
      // dir missing — skip
    }
  }
  return null;
}

/**
 * Compute delivery receipts for all wires sent from the given telegraph directory.
 * Scans outbox/, outbox/!* (failed), and outbox/history/ (delivered/acked).
 */
export function getDeliveryReceipts(telegraphDir: string): DeliveryReceipt[] {
  const receipts: DeliveryReceipt[] = [];
  const outboxDir = path.join(telegraphDir, 'outbox');
  const outboxHistoryDir = path.join(outboxDir, 'history');

  // pending: outbox/*.md (no ! prefix)
  for (const file of listMdFiles(outboxDir)) {
    if (file.startsWith('!')) continue; // handled separately as failed
    const subject = extractSubject(file);
    receipts.push({
      filename: file,
      subject: subject ?? file,
      status: 'pending',
      filePath: path.join(outboxDir, file),
    });
  }

  // failed: outbox/!*.md
  try {
    for (const file of fs.readdirSync(outboxDir)) {
      if (file.startsWith('!') && file.endsWith('.md')) {
        const canonical = file.slice(1);
        const subject = extractSubject(canonical);
        receipts.push({
          filename: canonical,
          subject: subject ?? canonical,
          status: 'failed',
          filePath: path.join(outboxDir, file),
        });
      }
    }
  } catch {
    // outboxDir missing — ok
  }

  // delivered / acknowledged / blocked: outbox/history/*.md
  for (const file of listMdFiles(outboxHistoryDir)) {
    const subject = extractSubject(file);
    if (!subject) continue;
    const ackStatus = findAckStatus(telegraphDir, subject);
    const deliveredAt = readDeliveredAt(path.join(outboxHistoryDir, file));
    const status: WireStatus =
      ackStatus === 'acknowledged' ? 'acknowledged' :
      ackStatus === 'blocked' ? 'blocked' :
      'delivered';
    receipts.push({
      filename: file,
      subject,
      status,
      filePath: path.join(outboxHistoryDir, file),
      deliveredAt,
    });
  }

  return receipts;
}
