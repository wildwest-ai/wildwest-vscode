import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Test suite for telegraph delivery operator (deliverPendingOutbox).
 * 
 * Scenarios:
 * 1. Happy path — memo delivered to remote inbox
 * 2. Unknown destination role — warning logged, memo stays in outbox
 * 3. Empty outbox — no-op, returns 0 delivered
 * 4. Local destination (same scope) — delivers into local inbox and archives sent copy
 * 5. Invalid role format — warning logged, skip memo
 * 6. Missing 'to:' field — warning logged, skip memo
 * 7. Invalid YAML — handled gracefully, logs error
 */

// Mocked scope resolution functions (extracted from HeartbeatMonitor)
const SCOPE_ROLES: Record<string, string[]> = {
  'territory': ['G', 'RA'],
  'county': ['S', 'CD', 'TM'],
  'town': ['Mayor', 'TM', 'HG'],
};

function extractRole(actorField: string): string | null {
  const match = actorField.match(/^([A-Za-z]+)/);
  return match ? match[1] : null;
}

function resolveRoleToScope(role: string): string | null {
  for (const [scope, roles] of Object.entries(SCOPE_ROLES)) {
    if (roles.includes(role)) {
      return scope;
    }
  }
  return null;
}

function resolveScopePath(
  currentScope: string,
  currentPath: string,
  destScope: string,
  worldRoot: string,
  countiesDir: string,
): string | null {
  if (currentScope === destScope) {
    return currentPath;
  }

  if (destScope === 'territory') {
    return worldRoot;
  }

  if (destScope === 'county') {
    if (currentScope === 'town') {
      const parts = currentPath.split(path.sep);
      const countiesIdx = parts.indexOf(countiesDir);
      if (countiesIdx >= 0 && countiesIdx + 1 < parts.length) {
        return parts.slice(0, countiesIdx + 2).join(path.sep);
      }
    }
    return null;
  }

  return null;
}

function parseMemoFrontmatter(memoPath: string): Record<string, unknown> {
  try {
    const content = fs.readFileSync(memoPath, 'utf8');
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    if (!match) return {};
    const frontmatter = match[1];
    const result: Record<string, unknown> = {};
    const lines = frontmatter.split('\n');
    for (const line of lines) {
      const [key, ...valueParts] = line.split(':');
      if (key && valueParts.length > 0) {
        const value = valueParts.join(':').trim();
        result[key.trim()] = value;
      }
    }
    return result;
  } catch {
    return {};
  }
}

// Test delivery operator (simplified version of actual implementation)
function deliverPendingOutbox(
  rootPath: string,
  scope: string,
  logs: string[],
  worldRoot: string,
  countiesDir: string,
): { delivered: number; failed: number } {
  let delivered = 0;
  let failed = 0;

  try {
    const outboxDir = path.join(rootPath, '.wildwest', 'telegraph', 'outbox');
    if (!fs.existsSync(outboxDir)) {
      return { delivered, failed };
    }

    const entries = fs.readdirSync(outboxDir);
    const memoFiles = entries.filter((e) => e.endsWith('.md') && !e.startsWith('.'));

    for (const memoFile of memoFiles) {
      try {
        const memoPath = path.join(outboxDir, memoFile);
        const frontmatter = parseMemoFrontmatter(memoPath);
        const toField = frontmatter['to'] as string | undefined;

        if (!toField) {
          logs.push(`[HeartbeatMonitor] delivery: ${memoFile} has no 'to:' field — skipping`);
          failed++;
          continue;
        }

        const role = extractRole(toField);
        if (!role) {
          logs.push(`[HeartbeatMonitor] delivery: ${memoFile} → ${toField} — invalid role format`);
          failed++;
          continue;
        }

        const destScope = resolveRoleToScope(role);
        if (!destScope) {
          logs.push(`[HeartbeatMonitor] delivery: ${memoFile} → ${role} — unknown role`);
          failed++;
          continue;
        }

        const destPath = resolveScopePath(scope, rootPath, destScope, worldRoot, countiesDir);

        if (!destPath) {
          logs.push(
            `[HeartbeatMonitor] delivery: ${memoFile} → ${toField} — unresolvable recipient`,
          );
          failed++;
          continue;
        } else {
          // Delivery to destination inbox, including local self-addressed mail
          const destInboxDir = path.join(destPath, '.wildwest', 'telegraph', 'inbox');
          if (!fs.existsSync(destInboxDir)) {
            fs.mkdirSync(destInboxDir, { recursive: true });
          }
          const destMemoPath = path.join(destInboxDir, memoFile);
          const originalContent = fs.readFileSync(memoPath, 'utf8');
          fs.writeFileSync(destMemoPath, originalContent, 'utf8');
          logs.push(
            `[HeartbeatMonitor] delivery: ${memoFile} → ${destPath}/.wildwest/telegraph/inbox/`,
          );
        }

        // Stamp delivered_at
        let content = fs.readFileSync(memoPath, 'utf8');
        const now = new Date().toISOString();
        const deliveredLine = `delivered_at: ${now}\n`;
        const frontmatterMatch = content.match(/^(---\n)/);
        if (frontmatterMatch) {
          content = frontmatterMatch[1] + deliveredLine + content.substring(frontmatterMatch[1].length);
        }

        // Archive
        const historyDir = path.join(outboxDir, 'history');
        if (!fs.existsSync(historyDir)) {
          fs.mkdirSync(historyDir, { recursive: true });
        }
        const historyPath = path.join(historyDir, memoFile);
        fs.writeFileSync(historyPath, content, 'utf8');
        fs.unlinkSync(memoPath);

        delivered++;
      } catch (err) {
        logs.push(`[HeartbeatMonitor] delivery error for ${memoFile}: ${err}`);
        failed++;
      }
    }
  } catch (err) {
    logs.push(`[HeartbeatMonitor] outbox scan error: ${err}`);
  }

  if (delivered > 0 || failed > 0) {
    logs.push(`[HeartbeatMonitor] outbox delivery: ${delivered} delivered, ${failed} failed`);
  }

  return { delivered, failed };
}

describe('Telegraph Delivery', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'telegraph-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('deliverPendingOutbox()', () => {
    test('Happy path — memo delivered to remote inbox', () => {
      // Create nested structure: worldRoot/counties/mycounty/, worldRoot/counties/mycounty/towns/mytown/
      const worldRoot = tempDir;
      const countyPath = path.join(worldRoot, 'counties', 'mycounty');
      const townPath = path.join(countyPath, 'mytown');

      fs.mkdirSync(path.join(townPath, '.wildwest', 'telegraph', 'outbox'), { recursive: true });
      fs.mkdirSync(countyPath, { recursive: true });

      const memoContent = `---
to: CD(RSn).Cpt
from: TM(RHk).Cpt
subject: test
---

Test memo`;

      fs.writeFileSync(
        path.join(townPath, '.wildwest', 'telegraph', 'outbox', 'test-memo.md'),
        memoContent,
      );

      const logs: string[] = [];
      const result = deliverPendingOutbox(townPath, 'town', logs, worldRoot, 'counties');

      expect(result.delivered).toBe(1);
      expect(result.failed).toBe(0);
      expect(logs.some((l) => l.includes('delivered'))).toBe(true);

      // Check memo was archived
      const historyPath = path.join(townPath, '.wildwest', 'telegraph', 'outbox', 'history', 'test-memo.md');
      expect(fs.existsSync(historyPath)).toBe(true);

      // Check memo was delivered to county inbox
      const countyInboxPath = path.join(countyPath, '.wildwest', 'telegraph', 'inbox', 'test-memo.md');
      expect(fs.existsSync(countyInboxPath)).toBe(true);

      // Check delivered_at was stamped
      const archivedContent = fs.readFileSync(historyPath, 'utf8');
      expect(archivedContent).toContain('delivered_at:');
    });

    test('Unknown role — warning logged, memo stays in outbox', () => {
      const worldRoot = tempDir;
      const townPath = path.join(worldRoot, 'counties', 'myc', 'mytown');
      fs.mkdirSync(path.join(townPath, '.wildwest', 'telegraph', 'outbox'), { recursive: true });

      const memoContent = `---
to: INVALID(XXX).Cpt
from: TM(RHk).Cpt
---

Test`;

      fs.writeFileSync(
        path.join(townPath, '.wildwest', 'telegraph', 'outbox', 'test-memo.md'),
        memoContent,
      );

      const logs: string[] = [];
      const result = deliverPendingOutbox(townPath, 'town', logs, worldRoot, 'counties');

      expect(result.delivered).toBe(0);
      expect(result.failed).toBe(1);
      expect(logs.some((l) => l.includes('unknown role'))).toBe(true);

      // Memo should still be in outbox
      expect(fs.existsSync(path.join(townPath, '.wildwest', 'telegraph', 'outbox', 'test-memo.md'))).toBe(true);
    });

    test('Empty outbox — no-op', () => {
      const worldRoot = tempDir;
      const townPath = path.join(worldRoot, 'counties', 'myc', 'mytown');
      fs.mkdirSync(path.join(townPath, '.wildwest', 'telegraph', 'outbox'), { recursive: true });

      const logs: string[] = [];
      const result = deliverPendingOutbox(townPath, 'town', logs, worldRoot, 'counties');

      expect(result.delivered).toBe(0);
      expect(result.failed).toBe(0);
    });

    test('Local destination (same scope) — delivered to local inbox', () => {
      const worldRoot = tempDir;
      const townPath = path.join(worldRoot, 'counties', 'myc', 'mytown');
      fs.mkdirSync(path.join(townPath, '.wildwest', 'telegraph', 'outbox'), { recursive: true });

      // Use HG role (town-only) instead of TM (which exists in both town and county)
      const memoContent = `---
to: HG(XXX).Cpt
from: Mayor(YYY).Cpt
---

Test`;

      fs.writeFileSync(
        path.join(townPath, '.wildwest', 'telegraph', 'outbox', 'test-memo.md'),
        memoContent,
      );

      const logs: string[] = [];
      const result = deliverPendingOutbox(townPath, 'town', logs, worldRoot, 'counties');

      expect(result.delivered).toBe(1);
      expect(logs.some((l) => l.includes('/.wildwest/telegraph/inbox/'))).toBe(true);

      // Local destination still receives an inbox copy.
      expect(fs.existsSync(path.join(townPath, '.wildwest', 'telegraph', 'inbox', 'test-memo.md'))).toBe(true);
    });

    test('Missing to: field — warning logged, skip memo', () => {
      const worldRoot = tempDir;
      const townPath = path.join(worldRoot, 'counties', 'myc', 'mytown');
      fs.mkdirSync(path.join(townPath, '.wildwest', 'telegraph', 'outbox'), { recursive: true });

      const memoContent = `---
from: TM(RHk).Cpt
subject: test
---

No to field`;

      fs.writeFileSync(
        path.join(townPath, '.wildwest', 'telegraph', 'outbox', 'test-memo.md'),
        memoContent,
      );

      const logs: string[] = [];
      const result = deliverPendingOutbox(townPath, 'town', logs, worldRoot, 'counties');

      expect(result.delivered).toBe(0);
      expect(result.failed).toBe(1);
      expect(logs.some((l) => l.includes("has no 'to:' field"))).toBe(true);
    });

    test('Invalid role format — warning logged, skip memo', () => {
      const worldRoot = tempDir;
      const townPath = path.join(worldRoot, 'counties', 'myc', 'mytown');
      fs.mkdirSync(path.join(townPath, '.wildwest', 'telegraph', 'outbox'), { recursive: true });

      const memoContent = `---
to: (Invalid).Cpt
---

Test`;

      fs.writeFileSync(
        path.join(townPath, '.wildwest', 'telegraph', 'outbox', 'test-memo.md'),
        memoContent,
      );

      const logs: string[] = [];
      const result = deliverPendingOutbox(townPath, 'town', logs, worldRoot, 'counties');

      expect(result.delivered).toBe(0);
      expect(result.failed).toBe(1);
      expect(logs.some((l) => l.includes('invalid role format'))).toBe(true);
    });

    test('Territory delivery — uses world root', () => {
      // Create: worldRoot/counties/myc/mytown/, worldRoot/
      const worldRoot = tempDir;
      const countyPath = path.join(worldRoot, 'counties', 'myc');
      const townPath = path.join(countyPath, 'mytown');

      fs.mkdirSync(path.join(townPath, '.wildwest', 'telegraph', 'outbox'), { recursive: true });
      fs.mkdirSync(worldRoot, { recursive: true });

      // Use 'G' role (Governor, territory scope) per SCOPE_ROLES mapping
      const memoContent = `---
to: G(R).Cpt
from: TM(RHk).Cpt
---

Test`;

      fs.writeFileSync(
        path.join(townPath, '.wildwest', 'telegraph', 'outbox', 'test-memo.md'),
        memoContent,
      );

      const logs: string[] = [];
      const result = deliverPendingOutbox(townPath, 'town', logs, worldRoot, 'counties');

      expect(result.delivered).toBe(1);
      expect(logs.some((l) => l.includes(worldRoot))).toBe(true);

      // Check memo delivered to world inbox
      const worldInboxPath = path.join(worldRoot, '.wildwest', 'telegraph', 'inbox', 'test-memo.md');
      expect(fs.existsSync(worldInboxPath)).toBe(true);
    });
  });
});
