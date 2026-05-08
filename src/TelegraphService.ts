/**
 * TelegraphService — shared telegraph primitives
 *
 * Pure stateless helpers extracted from TelegraphCommands, TelegraphInbox,
 * and WildwestParticipant to eliminate duplication across the telegraph stack.
 *
 * Nothing in this module depends on vscode APIs except getTelegraphDirs(),
 * which uses vscode.workspace.workspaceFolders.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

// ---------------------------------------------------------------------------
// Timestamp helpers
// ---------------------------------------------------------------------------

/** UTC timestamp in Wild West memo filename format: YYYYMMDD-HHMMz */
export function telegraphTimestamp(d: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}Z`
  );
}

/** UTC timestamp in ISO 8601 format (no milliseconds). */
export function telegraphISOTimestamp(d: Date = new Date()): string {
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

/** Canonical inbox directory for a telegraph bus root. */
export function inboxPath(telegraphDir: string): string {
  return path.join(telegraphDir, 'inbox');
}

/** Canonical outbox directory for a telegraph bus root. */
export function outboxPath(telegraphDir: string): string {
  return path.join(telegraphDir, 'outbox');
}

// ---------------------------------------------------------------------------
// Frontmatter parsing
// ---------------------------------------------------------------------------

/**
 * Parse YAML frontmatter from a memo file.
 * Returns a flat string→string map of the frontmatter keys.
 * Returns {} on any parse error.
 */
export function parseFrontmatter(filePath: string): Record<string, string> {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    if (!match) return {};
    const result: Record<string, string> = {};
    for (const line of match[1].split('\n')) {
      const colonIdx = line.indexOf(':');
      if (colonIdx < 1) continue;
      const key = line.slice(0, colonIdx).trim();
      const value = line.slice(colonIdx + 1).trim();
      if (key) result[key] = value;
    }
    return result;
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Archive helper
// ---------------------------------------------------------------------------

/**
 * Move a memo from its current location to `historyDir/<filename>`.
 * Creates `historyDir` (and parents) if necessary.
 * Throws on rename failure — callers should catch if needed.
 */
export function archiveMemo(srcPath: string, historyDir: string): void {
  fs.mkdirSync(historyDir, { recursive: true });
  fs.renameSync(srcPath, path.join(historyDir, path.basename(srcPath)));
}

// ---------------------------------------------------------------------------
// Registry alias
// ---------------------------------------------------------------------------

/**
 * Read the `alias` field from `.wildwest/registry.json`.
 * `wwDir` should be the `.wildwest/` directory (not its parent).
 * Returns null on any read or parse error.
 */
export function readRegistryAlias(wwDir: string): string | null {
  try {
    const reg = JSON.parse(
      fs.readFileSync(path.join(wwDir, 'registry.json'), 'utf8'),
    ) as Record<string, unknown>;
    return (reg['alias'] as string) || null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Workspace discovery
// ---------------------------------------------------------------------------

/**
 * Return all `.wildwest/telegraph/` directories visible in workspace folders.
 * Filters to directories that actually exist on disk.
 */
export function getTelegraphDirs(): string[] {
  const dirs: string[] = [];
  for (const f of vscode.workspace.workspaceFolders ?? []) {
    const dir = path.join(f.uri.fsPath, '.wildwest', 'telegraph');
    if (fs.existsSync(dir)) {
      dirs.push(dir);
    }
  }
  return dirs;
}
