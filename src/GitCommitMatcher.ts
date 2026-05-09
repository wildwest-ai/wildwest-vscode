/**
 * GitCommitMatcher — counts git commits to a repo within a session's time window.
 *
 * Used by the orchestrator to populate `commit_count` on ScopeRef entries.
 * Sessions with `commit_count > 0` on a town's scope_ref are considered
 * primary attributions for that town (stronger evidence than signal_count alone).
 */

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

export class GitCommitMatcher {
  /**
   * Count commits in `repoPath` authored between `after` and `before` (ISO strings).
   * Adds a 2-hour buffer on each side to account for session prep/wrap.
   * Returns 0 if the path is not a git repo or git is unavailable.
   */
  static countCommits(repoPath: string, after: string, before: string): number {
    if (!repoPath || !fs.existsSync(repoPath)) return 0;

    // Walk up to find .git root — repoPath may be a sub-directory
    const gitRoot = GitCommitMatcher.findGitRoot(repoPath);
    if (!gitRoot) return 0;

    // Expand window by 2 hours
    const afterMs = new Date(after).getTime() - 2 * 60 * 60 * 1000;
    const beforeMs = new Date(before).getTime() + 2 * 60 * 60 * 1000;
    const afterIso = new Date(afterMs).toISOString();
    const beforeIso = new Date(beforeMs).toISOString();

    try {
      const result = execFileSync(
        'git',
        ['log', '--oneline', `--after=${afterIso}`, `--before=${beforeIso}`],
        { cwd: gitRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 },
      );
      return result.trim().split('\n').filter(Boolean).length;
    } catch {
      return 0;
    }
  }

  /**
   * Walk up from `startPath` to find the nearest directory containing `.git`.
   */
  private static findGitRoot(startPath: string): string | null {
    let current = fs.statSync(startPath).isDirectory() ? startPath : path.dirname(startPath);
    const fsRoot = path.parse(current).root;
    while (current && current !== fsRoot) {
      if (fs.existsSync(path.join(current, '.git'))) return current;
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
    return null;
  }
}
