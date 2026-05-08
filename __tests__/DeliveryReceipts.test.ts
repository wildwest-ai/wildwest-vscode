import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  getDeliveryReceipts,
  extractSubject,
  statusIcon,
  MemoStatus,
} from '../src/DeliveryReceipts';

describe('DeliveryReceipts', () => {
  let tempDir: string;
  let telegraphDir: string;
  let outboxDir: string;
  let outboxHistoryDir: string;
  let inboxDir: string;
  let inboxHistoryDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wildwest-receipts-'));
    telegraphDir = path.join(tempDir, '.wildwest', 'telegraph');
    outboxDir = path.join(telegraphDir, 'outbox');
    outboxHistoryDir = path.join(outboxDir, 'history');
    inboxDir = path.join(telegraphDir, 'inbox');
    inboxHistoryDir = path.join(inboxDir, 'history');
    fs.mkdirSync(outboxDir, { recursive: true });
    fs.mkdirSync(outboxHistoryDir, { recursive: true });
    fs.mkdirSync(inboxDir, { recursive: true });
    fs.mkdirSync(inboxHistoryDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  // ── extractSubject ──────────────────────────────────────────────────────

  describe('extractSubject', () => {
    it('extracts subject from standard memo filename', () => {
      expect(extractSubject('20260508-1200Z-to-CD-from-TM--important-task.md')).toBe('important-task');
    });

    it('extracts subject from legacy filename without timestamp', () => {
      expect(extractSubject('to-CD-from-TM--old-subject.md')).toBe('old-subject');
    });

    it('strips ! prefix before extracting', () => {
      expect(extractSubject('!20260508-1200Z-to-CD-from-TM--failed-memo.md')).toBe('failed-memo');
    });

    it('returns null for non-matching filenames', () => {
      expect(extractSubject('random-file.md')).toBeNull();
    });
  });

  // ── statusIcon ──────────────────────────────────────────────────────────

  describe('statusIcon', () => {
    const cases: [MemoStatus, string][] = [
      ['pending', '○'],
      ['delivered', '✓'],
      ['acknowledged', '✓✓'],
      ['failed', '✗'],
      ['blocked', '⚠'],
    ];
    it.each(cases)('statusIcon(%s) = %s', (status, icon) => {
      expect(statusIcon(status)).toBe(icon);
    });
  });

  // ── getDeliveryReceipts ─────────────────────────────────────────────────

  it('returns empty array when outbox does not exist', () => {
    fs.rmSync(outboxDir, { recursive: true });
    expect(getDeliveryReceipts(telegraphDir)).toEqual([]);
  });

  it('returns pending receipt for memo in outbox/', () => {
    const file = '20260508-1200Z-to-CD-from-TM--my-task.md';
    fs.writeFileSync(path.join(outboxDir, file), '---\nfrom: TM\nto: CD\n---\n\nBody.\n');

    const receipts = getDeliveryReceipts(telegraphDir);
    expect(receipts).toHaveLength(1);
    expect(receipts[0].status).toBe('pending');
    expect(receipts[0].subject).toBe('my-task');
    expect(receipts[0].filename).toBe(file);
    expect(receipts[0].filePath).toBe(path.join(outboxDir, file));
  });

  it('returns failed receipt for !-prefixed memo in outbox/', () => {
    const file = '20260508-1200Z-to-CD-from-TM--bad-address.md';
    fs.writeFileSync(path.join(outboxDir, `!${file}`), 'body');

    const receipts = getDeliveryReceipts(telegraphDir);
    expect(receipts).toHaveLength(1);
    expect(receipts[0].status).toBe('failed');
    expect(receipts[0].subject).toBe('bad-address');
    expect(receipts[0].filename).toBe(file); // canonical, no !
    expect(receipts[0].filePath).toBe(path.join(outboxDir, `!${file}`));
  });

  it('returns delivered when memo is in outbox/history/ with no ack', () => {
    const file = '20260508-1200Z-to-CD-from-TM--report.md';
    fs.writeFileSync(
      path.join(outboxHistoryDir, file),
      '---\ndelivered_at: 2026-05-08T12:05:00.000Z\nfrom: TM\nto: CD\n---\n',
    );

    const receipts = getDeliveryReceipts(telegraphDir);
    expect(receipts).toHaveLength(1);
    expect(receipts[0].status).toBe('delivered');
    expect(receipts[0].deliveredAt).toBe('2026-05-08T12:05:00.000Z');
    expect(receipts[0].filePath).toBe(path.join(outboxHistoryDir, file));
  });

  it('returns acknowledged when inbox has ack-done for the subject', () => {
    const memoFile = '20260508-1200Z-to-CD-from-TM--review-request.md';
    fs.writeFileSync(path.join(outboxHistoryDir, memoFile), '---\nfrom: TM\n---\n');
    // Recipient sent back an ack
    const ackFile = '20260508-1300Z-to-TM-from-CD--ack-done--review-request.md';
    fs.writeFileSync(path.join(inboxHistoryDir, ackFile), 'ack body');

    const receipts = getDeliveryReceipts(telegraphDir);
    expect(receipts).toHaveLength(1);
    expect(receipts[0].status).toBe('acknowledged');
  });

  it('returns blocked when inbox has ack-blocked for the subject', () => {
    const memoFile = '20260508-1200Z-to-CD-from-TM--deploy-request.md';
    fs.writeFileSync(path.join(outboxHistoryDir, memoFile), '---\nfrom: TM\n---\n');
    const ackFile = '20260508-1300Z-to-TM-from-CD--ack-blocked--deploy-request.md';
    fs.writeFileSync(path.join(inboxDir, ackFile), 'blocked body'); // still in inbox, not history

    const receipts = getDeliveryReceipts(telegraphDir);
    expect(receipts).toHaveLength(1);
    expect(receipts[0].status).toBe('blocked');
  });

  it('aggregates pending, delivered, failed receipts together', () => {
    fs.writeFileSync(path.join(outboxDir, '20260508-1000Z-to-CD-from-TM--alpha.md'), 'body');
    fs.writeFileSync(path.join(outboxDir, '!20260508-1100Z-to-CD-from-TM--beta.md'), 'body');
    fs.writeFileSync(path.join(outboxHistoryDir, '20260508-0900Z-to-CD-from-TM--gamma.md'), 'body');

    const receipts = getDeliveryReceipts(telegraphDir);
    expect(receipts).toHaveLength(3);
    const statuses = receipts.map((r) => r.status).sort();
    expect(statuses).toEqual(['delivered', 'failed', 'pending']);
  });

  it('skips files without recognizable subject in outbox/history/', () => {
    fs.writeFileSync(path.join(outboxHistoryDir, 'not-a-memo.md'), 'body');

    const receipts = getDeliveryReceipts(telegraphDir);
    expect(receipts).toHaveLength(0);
  });
});
