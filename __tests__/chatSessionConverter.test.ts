import { ChatSessionConverter } from '../src/chatSessionConverter';
import fs from 'fs';
import os from 'os';
import path from 'path';

describe('ChatSessionConverter', () => {
  let testDir: string;
  let sessionPath: string;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wildwest-chat-session-'));
    sessionPath = path.join(testDir, 'copilot-session.json');

    fs.mkdirSync(testDir, { recursive: true });
    fs.writeFileSync(
      sessionPath,
      JSON.stringify({
        version: 1,
        sessionId: 'copilot-session',
        creationDate: Date.now(),
        lastMessageDate: Date.now(),
        requests: [
          {
            requestId: 'r1',
            message: { text: 'Test prompt' },
            response: [{ kind: 'text', value: 'Test response' }],
            timestamp: Date.now(),
          },
        ],
      }, null, 2)
    );
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('generates raw chat log', () => {
    const converter = new ChatSessionConverter(sessionPath, 'testuser');
    const log = converter.generateRawChatLog();
    expect(log).toContain('testuser: Test prompt');
    expect(log).toContain('GitHub Copilot: Test response');
  });

  it('generates chat replay JSON', () => {
    const converter = new ChatSessionConverter(sessionPath, 'testuser');
    const replay = converter.generateChatReplayJson();
    expect(replay.github_userid).toBe('testuser');
    expect(replay.prompts[0].prompt).toBe('Test prompt');
    expect(replay.prompts[0].response).toBe('Test response');
  });
});
