import { convertJsonFileToMarkdown } from '../src/jsonToMarkdown';
import fs from 'fs';
import path from 'path';

describe('jsonToMarkdown', () => {
  const testDir = path.join(__dirname, 'testdata');
  const jsonPath = path.join(testDir, 'session.json');
  const mdPath = path.join(testDir, 'session.md');

  beforeAll(() => {
    fs.mkdirSync(testDir, { recursive: true });
    fs.writeFileSync(
      jsonPath,
      JSON.stringify({
        exportedAt: new Date().toISOString(),
        github_userid: 'testuser',
        user_timezone_offset: '+00:00',
        totalPrompts: 1,
        totalLogEntries: 2,
        sourceSession: {
          sessionId: 'test-session',
          creationDate: Date.now(),
          lastMessageDate: Date.now(),
          requests: [
            {
              message: { text: 'Prompt?' },
              response: [{ kind: 'text', value: 'Answer.' }],
              timestamp: Date.now(),
            },
          ],
        },
        prompts: [
          {
            prompt: 'Prompt?',
            timestamp: Date.now(),
            response: 'Answer.',
            hasSeen: false,
            logCount: 2,
            logs: [],
          },
        ],
      }, null, 2)
    );
  });

  afterAll(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('converts replay JSON to Markdown', () => {
    const out = convertJsonFileToMarkdown(jsonPath, mdPath);
    const md = fs.readFileSync(out, 'utf8');
    expect(md).toContain('# Wild West Session');
    expect(md).toContain('testuser');
    expect(md).toContain('Prompt?');
    expect(md).toContain('Answer.');
  });
});
