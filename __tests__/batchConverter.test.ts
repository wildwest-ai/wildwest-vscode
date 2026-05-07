import { BatchChatConverter } from '../src/batchConverter';
import fs from 'fs';
import os from 'os';
import path from 'path';

describe('BatchChatConverter', () => {
  let testExportPath: string;
  let rawCopilotDir: string;
  let rawCodexDir: string;
  let stagedDir: string;

  beforeEach(() => {
    testExportPath = fs.mkdtempSync(path.join(os.tmpdir(), 'wildwest-batch-converter-'));
    rawCopilotDir = path.join(testExportPath, 'raw', 'github-copilot');
    rawCodexDir = path.join(testExportPath, 'raw', 'chatgpt-codex');
    stagedDir = path.join(testExportPath, 'staged');

    // Setup testdata directories and files
    fs.mkdirSync(rawCopilotDir, { recursive: true });
    fs.mkdirSync(rawCodexDir, { recursive: true });
    fs.mkdirSync(stagedDir, { recursive: true });
    // Minimal Copilot session JSON
    fs.writeFileSync(
      path.join(rawCopilotDir, 'copilot-session.json'),
      JSON.stringify({
        version: 1,
        sessionId: 'copilot-session',
        creationDate: Date.now(),
        lastMessageDate: Date.now(),
        requests: [
          {
            requestId: 'r1',
            message: { text: 'Hello Copilot' },
            response: [{ kind: 'text', value: 'Hi there!' }],
            timestamp: Date.now(),
          },
        ],
      }, null, 2)
    );
    // Minimal Codex .jsonl log
    fs.writeFileSync(
      path.join(rawCodexDir, 'codex-session.jsonl'),
      [
        JSON.stringify({
          type: 'session_meta',
          payload: { id: 'codex-session', git: { user: 'testuser' } },
          timestamp: new Date().toISOString(),
        }),
        JSON.stringify({
          type: 'response_item',
          payload: {
            role: 'user',
            type: 'message',
            content: [{ text: 'Hello Codex' }],
          },
          timestamp: new Date().toISOString(),
        }),
        JSON.stringify({
          type: 'response_item',
          payload: {
            role: 'assistant',
            type: 'message',
            content: [{ text: 'Hi from Codex!' }],
          },
          timestamp: new Date().toISOString(),
        }),
      ].join('\n')
    );
  });

  afterEach(() => {
    // Cleanup testdata
    fs.rmSync(testExportPath, { recursive: true, force: true });
  });

  it('converts github-copilot session to staged JSON', async () => {
    const converter = new BatchChatConverter(testExportPath, false);
    await converter.run();
    const stagedFiles = fs.readdirSync(stagedDir).filter(f => f.endsWith('.json'));
    // The staged file should have the 8-char prefix of the sessionId ("copilot-session" → "copilot-")
    expect(stagedFiles.some(f => f.match(/_copilot-\w*\.json$/))).toBe(true);
  });

  it('converts chatgpt-codex .jsonl log to staged JSON', async () => {
    const converter = new BatchChatConverter(testExportPath, false);
    await converter.run();
    const stagedFiles = fs.readdirSync(stagedDir).filter(f => f.endsWith('.json'));
    // The staged file should have the 8-char prefix of the sessionId ("codex-session" → "codex-se")
    expect(stagedFiles.some(f => f.match(/_codex-se\w*\.json$/))).toBe(true);
  });
});
