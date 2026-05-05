import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Mock the cleanup function logic for testing
function cleanupTelegraph(
  telegraphDir: string,
): { archived: number; open: number } {
  let archived = 0;
  let open = 0;

  try {
    if (!fs.existsSync(telegraphDir)) return { archived, open };

    const entries = fs.readdirSync(telegraphDir);
    const ackFiles = entries.filter(
      (e) => e.includes('ack-done--') || e.includes('ack-deferred--'),
    );

    for (const ackFile of ackFiles) {
      try {
        // Extract subject from ack file: match pattern like "20260505-1824Z-ack--subject.md"
        let subject: string | null = null;
        if (ackFile.includes('ack-done--')) {
          subject = ackFile.split('ack-done--')[1]?.replace('.md', '');
        } else if (ackFile.includes('ack-deferred--')) {
          subject = ackFile.split('ack-deferred--')[1]?.replace('.md', '');
        }
        if (!subject) continue;
        const paired = entries.find(
          (e) => e !== ackFile && e.includes(`--${subject}.md`),
        );

        const ackPath = path.join(telegraphDir, ackFile);
        const historyDir = path.join(telegraphDir, 'history');

        if (!fs.existsSync(historyDir)) {
          fs.mkdirSync(historyDir, { recursive: true });
        }

        fs.renameSync(ackPath, path.join(historyDir, ackFile));
        archived++;

        if (paired) {
          const pairedPath = path.join(telegraphDir, paired);
          fs.renameSync(pairedPath, path.join(historyDir, paired));
          archived++;
        }
      } catch (err) {
        // ignore individual file errors
      }
    }

    const openFiles = entries.filter(
      (e) => e.includes('ack-blocked--') || e.includes('ack-question--'),
    );
    open = openFiles.length;
  } catch (err) {
    // ignore scan errors
  }

  return { archived, open };
}

describe('HeartbeatMonitor telegraph cleanup', () => {
  let testDir: string;
  let telegraphDir: string;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'telegraph-test-'));
    telegraphDir = path.join(testDir, '.wildwest', 'telegraph');
    fs.mkdirSync(telegraphDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  test('should archive ack-done and paired memo', () => {
    // Create files
    fs.writeFileSync(
      path.join(telegraphDir, '20260505-1748Z-to-TM-from-RA--raid-notify.md'),
      'memo content',
    );
    fs.writeFileSync(
      path.join(telegraphDir, '20260505-1824Z-ack-done--raid-notify.md'),
      'ack content',
    );

    const result = cleanupTelegraph(telegraphDir);

    expect(result.archived).toBe(2);
    expect(result.open).toBe(0);

    // Verify files moved to history
    const historyDir = path.join(telegraphDir, 'history');
    expect(fs.existsSync(path.join(historyDir, '20260505-1748Z-to-TM-from-RA--raid-notify.md'))).toBe(
      true,
    );
    expect(fs.existsSync(path.join(historyDir, '20260505-1824Z-ack-done--raid-notify.md'))).toBe(true);

    // Verify original files removed
    expect(fs.existsSync(path.join(telegraphDir, '20260505-1748Z-to-TM-from-RA--raid-notify.md'))).toBe(
      false,
    );
  });

  test('should leave ack-blocked and ack-question in place', () => {
    fs.writeFileSync(
      path.join(telegraphDir, '20260505-1824Z-ack-blocked--important-question.md'),
      'ack content',
    );
    fs.writeFileSync(path.join(telegraphDir, '20260505-1825Z-ack-question--something.md'), 'ack content');

    const result = cleanupTelegraph(telegraphDir);

    expect(result.archived).toBe(0);
    expect(result.open).toBe(2); // both ack-blocked and ack-question are open

    // Verify files still in telegraph root
    expect(
      fs.existsSync(path.join(telegraphDir, '20260505-1824Z-ack-blocked--important-question.md')),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(telegraphDir, '20260505-1825Z-ack-question--something.md')),
    ).toBe(true);
  });

  test('should create history directory if missing', () => {
    fs.writeFileSync(
      path.join(telegraphDir, '20260505-1748Z-to-TM-from-RA--test.md'),
      'memo',
    );
    fs.writeFileSync(path.join(telegraphDir, '20260505-1824Z-ack-done--test.md'), 'ack');

    const result = cleanupTelegraph(telegraphDir);

    expect(result.archived).toBe(2);
    expect(fs.existsSync(path.join(telegraphDir, 'history'))).toBe(true);
  });

  test('should handle missing telegraph directory gracefully', () => {
    const missingDir = path.join(testDir, 'missing');
    const result = cleanupTelegraph(missingDir);

    expect(result.archived).toBe(0);
    expect(result.open).toBe(0);
  });

  test('should handle ack-deferred files', () => {
    fs.writeFileSync(
      path.join(telegraphDir, '20260505-1748Z-to-TM-from-RA--deferred-task.md'),
      'memo',
    );
    fs.writeFileSync(
      path.join(telegraphDir, '20260505-1824Z-ack-deferred--deferred-task.md'),
      'ack',
    );

    const result = cleanupTelegraph(telegraphDir);

    expect(result.archived).toBe(2);
    const historyDir = path.join(telegraphDir, 'history');
    expect(fs.existsSync(path.join(historyDir, '20260505-1824Z-ack-deferred--deferred-task.md'))).toBe(
      true,
    );
  });
});
