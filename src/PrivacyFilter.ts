/**
 * Privacy Filter
 *
 * Redacts secrets, tokens, and absolute paths from session content
 * before it is written to staged export packets.
 *
 * Activated by `wildwest.privacy.enabled` setting (default: false).
 * Applied in SessionExportPipeline.exportSession() after transformTurns().
 */

import { NormalizedTurn, ContentPart } from './sessionPipeline/types';

// ---------------------------------------------------------------------------
// Redaction patterns
// ---------------------------------------------------------------------------

/** Replacement tokens — kept short for readability in exported text */
const REDACT_SECRET  = '[REDACTED:secret]';
const REDACT_PATH    = '[REDACTED:path]';
const REDACT_ENV_VAL = '[REDACTED:env]';

/**
 * Ordered list of redaction rules applied to each content string.
 * Rules are applied sequentially; earlier rules take priority.
 */
const SECRET_PATTERNS: Array<{ label: string; pattern: RegExp; replacement: string }> = [
  // GitHub tokens
  {
    label: 'github-token',
    pattern: /\b(ghp_|ghs_|gho_|ghu_|ghr_|github_pat_)[A-Za-z0-9_]{10,}\b/g,
    replacement: REDACT_SECRET,
  },
  // AWS access key ID
  {
    label: 'aws-key-id',
    pattern: /\bAKIA[0-9A-Z]{16}\b/g,
    replacement: REDACT_SECRET,
  },
  // Bearer / Authorization header values
  {
    label: 'bearer-token',
    pattern: /(Bearer\s+)[A-Za-z0-9\-._~+/]+=*/gi,
    replacement: `$1${REDACT_SECRET}`,
  },
  // Generic API key / secret / token in key=value form (env-style or JSON)
  // Matches: API_KEY=abc123, SOME_TOKEN="xyz", "secret": "val", 'password': 'val'
  {
    label: 'env-secret-assignment',
    pattern: /\b((?:api[_-]?key|api[_-]?secret|access[_-]?token|secret[_-]?key|private[_-]?key|auth[_-]?token|password|passwd|credentials?|client[_-]?secret)\s*[=:]\s*['"]?)[^\s'"`,;]{8,}(['"]?)/gi,
    replacement: `$1${REDACT_SECRET}$2`,
  },
  // OpenAI / Anthropic / generic sk- tokens
  {
    label: 'sk-token',
    pattern: /\b(sk-(?:ant-|proj-)?)[A-Za-z0-9\-_]{20,}\b/g,
    replacement: REDACT_SECRET,
  },
];

const ENV_VAR_PATTERN: RegExp =
  /^(export\s+)?([A-Z_][A-Z0-9_]{3,})\s*=\s*(['"]?)(.{4,})(\3)\s*$/gm;

// ---------------------------------------------------------------------------
// Core redaction logic (pure functions)
// ---------------------------------------------------------------------------

/**
 * Redact secret token patterns from a single string.
 * Returns the redacted string.
 */
export function redactSecrets(text: string): string {
  let result = text;
  for (const rule of SECRET_PATTERNS) {
    result = result.replace(rule.pattern, rule.replacement);
  }
  // Env var assignments: export FOO="bar" → export FOO=[REDACTED:env]
  result = result.replace(ENV_VAR_PATTERN, (_m, exp, key, q1, _val, q2) => {
    // Skip obviously non-sensitive vars (PATH, HOME, USER, SHELL, TERM, etc.)
    if (/^(PATH|HOME|USER|SHELL|TERM|LANG|PWD|OLDPWD|LOGNAME|DISPLAY)$/.test(key)) {
      return _m;
    }
    return `${exp ?? ''}${key}=${q1}${REDACT_ENV_VAL}${q2}`;
  });
  return result;
}

/**
 * Replace occurrences of the user's home directory with `~`.
 * Also redacts any remaining absolute paths under common system roots.
 */
export function redactPaths(text: string, homeDir: string): string {
  let result = text;

  // Replace literal home dir with ~
  if (homeDir && homeDir !== '~') {
    // Escape special regex chars in path
    const escapedHome = homeDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    result = result.replace(new RegExp(escapedHome, 'g'), '~');
  }

  // Redact remaining absolute paths outside home (e.g., /tmp/..., /var/..., C:\...)
  // Windows: C:\Users\... or D:\...
  result = result.replace(/\b[A-Z]:\\(?:[^\s\\/:*?"<>|\r\n]+\\)+[^\s\\/:*?"<>|\r\n]*/g, REDACT_PATH);
  // Unix-style absolute paths with 3+ components (avoid over-redacting short refs)
  result = result.replace(/(?<!\w)(\/(?:[^\s/]+\/){2,}[^\s/]*)/g, REDACT_PATH);

  return result;
}

/**
 * Apply all privacy redactions to a single content string.
 *
 * @param text     Raw content string
 * @param homeDir  User's home directory for path redaction (pass '' to skip)
 */
export function redactContent(text: string, homeDir: string = ''): string {
  let result = redactSecrets(text);
  if (homeDir) {
    result = redactPaths(result, homeDir);
  }
  return result;
}

/**
 * Apply privacy redaction to a ContentPart, returning a new part.
 */
function redactPart(part: ContentPart, homeDir: string): ContentPart {
  return { ...part, content: redactContent(part.content, homeDir) };
}

/**
 * Apply privacy redaction to a NormalizedTurn, returning a new turn.
 */
export function redactTurn(turn: NormalizedTurn, homeDir: string = ''): NormalizedTurn {
  return {
    ...turn,
    content: redactContent(turn.content, homeDir),
    parts: turn.parts.map((p) => redactPart(p, homeDir)),
  };
}

/**
 * Apply privacy redaction to an array of NormalizedTurns.
 */
export function redactTurns(turns: NormalizedTurn[], homeDir: string = ''): NormalizedTurn[] {
  return turns.map((t) => redactTurn(t, homeDir));
}
