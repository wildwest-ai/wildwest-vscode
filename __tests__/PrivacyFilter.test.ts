import { redactSecrets, redactPaths, redactContent, redactTurn, redactTurns } from '../src/PrivacyFilter';
import { NormalizedTurn } from '../src/sessionPipeline/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTurn(content: string, partContent: string = content): NormalizedTurn {
  return {
    turn_index: 0,
    role: 'user',
    content,
    parts: [{ kind: 'text', content: partContent }],
    meta: {},
    timestamp: '2026-05-08T00:00:00Z',
  };
}

// ---------------------------------------------------------------------------
// redactSecrets
// ---------------------------------------------------------------------------

describe('redactSecrets', () => {
  it('redacts GitHub ghp_ token', () => {
    const result = redactSecrets('token is ghp_AbCdEfGhIjKlMnOpQrStUv123456');
    expect(result).toContain('[REDACTED:secret]');
    expect(result).not.toContain('ghp_');
  });

  it('redacts GitHub ghs_ token', () => {
    // Input not in env-assignment form so token pattern fires
    const result = redactSecrets('header: ghs_AbCdEfGhIjKlMnOpQrStUvWxYz');
    expect(result).toContain('[REDACTED:secret]');
    expect(result).not.toContain('ghs_');
  });

  it('redacts AWS access key ID', () => {
    const result = redactSecrets('key: AKIAIOSFODNN7EXAMPLE');
    expect(result).toContain('[REDACTED:secret]');
    expect(result).not.toContain('AKIA');
  });

  it('redacts Bearer token', () => {
    const result = redactSecrets('Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');
    expect(result).toContain('[REDACTED:secret]');
    expect(result).toContain('Bearer'); // prefix retained
  });

  it('redacts sk- token', () => {
    // Standalone token — not inside env-assignment so token pattern fires
    const result = redactSecrets('key: sk-proj-abcdefghijklmnopqrstuvwxyz12345');
    expect(result).toContain('[REDACTED:secret]');
    expect(result).not.toContain('sk-proj-');
  });

  it('redacts Anthropic sk-ant- token', () => {
    const result = redactSecrets('key = sk-ant-api03-abcdefghijklmnopqrstuvwxyz12345678');
    expect(result).toContain('[REDACTED:secret]');
  });

  it('redacts generic API_KEY=value assignment', () => {
    // env-var pattern fires (correct — still redacted)
    const result = redactSecrets('API_KEY=super_secret_value_here');
    expect(result).not.toContain('super_secret_value_here');
    expect(result).toContain('[REDACTED');
  });

  it('redacts secret_key in colon-assignment form', () => {
    // env-secret-assignment pattern matches unquoted key form
    const result = redactSecrets('secret_key: abc123xyz456789');
    expect(result).toContain('[REDACTED:secret]');
    expect(result).not.toContain('abc123xyz456789');
  });

  it('redacts env var assignment for sensitive names', () => {
    const result = redactSecrets('export MY_TOKEN="super-secret-token-value"');
    expect(result).toContain('[REDACTED:env]');
    expect(result).not.toContain('super-secret-token-value');
  });

  it('does NOT redact PATH env var', () => {
    const result = redactSecrets('export PATH="/usr/local/bin:/usr/bin"');
    expect(result).toContain('/usr/local/bin');
    expect(result).not.toContain('[REDACTED:env]');
  });

  it('does NOT redact short innocuous strings', () => {
    const result = redactSecrets('The quick brown fox');
    expect(result).toBe('The quick brown fox');
  });

  it('handles empty string', () => {
    expect(redactSecrets('')).toBe('');
  });

  it('handles multiple secrets in one string', () => {
    const result = redactSecrets(
      'ghp_AbCdEfGhIjKlMnOpQrStUv123456 and AKIAIOSFODNN7EXAMPLE',
    );
    expect(result).not.toContain('ghp_');
    expect(result).not.toContain('AKIA');
    expect(result.match(/\[REDACTED:secret\]/g)?.length).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// redactPaths
// ---------------------------------------------------------------------------

describe('redactPaths', () => {
  const HOME = '/Users/reneyap';

  it('replaces home directory with ~', () => {
    const result = redactPaths('/Users/reneyap/projects/foo/bar.ts', HOME);
    expect(result).toContain('~');
    expect(result).not.toContain('/Users/reneyap');
  });

  it('redacts deep absolute Unix paths', () => {
    const result = redactPaths('config at /etc/nginx/sites-enabled/default', HOME);
    expect(result).toContain('[REDACTED:path]');
  });

  it('redacts Windows absolute paths', () => {
    const result = redactPaths('file at C:\\Users\\reneyap\\projects\\app.ts', HOME);
    expect(result).toContain('[REDACTED:path]');
  });

  it('does not redact short Unix paths with only 1-2 components', () => {
    // /tmp alone — only 1 component, should not be redacted
    const result = redactPaths('see /tmp for output', HOME);
    // Single-segment /tmp is not matched by the 2+ components rule
    expect(result).not.toContain('[REDACTED:path]');
  });

  it('leaves unrelated text unchanged', () => {
    const result = redactPaths('hello world', HOME);
    expect(result).toBe('hello world');
  });

  it('handles empty homeDir gracefully', () => {
    const result = redactPaths('/some/absolute/path/file.ts', '');
    // homeDir replacement skipped; deep path still redacted
    expect(result).toContain('[REDACTED:path]');
  });
});

// ---------------------------------------------------------------------------
// redactContent (combined)
// ---------------------------------------------------------------------------

describe('redactContent', () => {
  it('applies both secrets and path redaction', () => {
    const text = 'token=ghp_AbCdEfGhIjKlMnOpQrStUv123 path=/Users/reneyap/src/app.ts';
    const result = redactContent(text, '/Users/reneyap');
    expect(result).not.toContain('ghp_');
    expect(result).not.toContain('/Users/reneyap');
  });

  it('works with no homeDir', () => {
    const result = redactContent('token: sk-proj-abcdefghijklmnopqrstuvwxyz12345');
    expect(result).toContain('[REDACTED:secret]');
  });
});

// ---------------------------------------------------------------------------
// redactTurn / redactTurns
// ---------------------------------------------------------------------------

describe('redactTurn', () => {
  it('redacts content and all parts', () => {
    const turn = makeTurn('my secret: ghp_AbCdEfGhIjKlMnOpQrStUv123456');
    const result = redactTurn(turn, '/Users/reneyap');
    expect(result.content).toContain('[REDACTED:secret]');
    expect(result.parts[0].content).toContain('[REDACTED:secret]');
  });

  it('returns a new object (does not mutate original)', () => {
    const turn = makeTurn('ghp_AbCdEfGhIjKlMnOpQrStUv123456');
    const result = redactTurn(turn);
    expect(result).not.toBe(turn);
    expect(turn.content).toContain('ghp_'); // original unchanged
  });

  it('preserves non-content fields', () => {
    const turn = makeTurn('safe text');
    const result = redactTurn(turn);
    expect(result.turn_index).toBe(turn.turn_index);
    expect(result.role).toBe(turn.role);
    expect(result.timestamp).toBe(turn.timestamp);
  });

  it('handles multiple parts', () => {
    const turn: NormalizedTurn = {
      ...makeTurn('safe'),
      parts: [
        { kind: 'text', content: 'ghp_AbCdEfGhIjKlMnOpQrStUv123456' },
        { kind: 'thinking', content: 'sk-ant-abc123defghijklmnopqrstuvwxyz' },
      ],
    };
    const result = redactTurn(turn);
    expect(result.parts[0].content).toContain('[REDACTED:secret]');
    expect(result.parts[1].content).toContain('[REDACTED:secret]');
  });
});

describe('redactTurns', () => {
  it('redacts all turns in an array', () => {
    const turns = [
      makeTurn('ghp_AbCdEfGhIjKlMnOpQrStUv123456'),
      makeTurn('safe text'),
      makeTurn('AKIAIOSFODNN7EXAMPLE'),
    ];
    const results = redactTurns(turns);
    expect(results[0].content).toContain('[REDACTED:secret]');
    expect(results[1].content).toBe('safe text');
    expect(results[2].content).toContain('[REDACTED:secret]');
  });

  it('returns empty array for empty input', () => {
    expect(redactTurns([])).toEqual([]);
  });
});
