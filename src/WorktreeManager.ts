import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

export interface Worktree {
  path: string;
  branch: string;
  isHeartbeat: boolean;
  isMain: boolean;
}

export class WorktreeManager {
  private repoRoot: string | null = null;

  getRepoRoot(): string | null {
    if (this.repoRoot) return this.repoRoot;
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) return null;
    // In multi-root workspaces, prefer the folder that is a governed town (.wildwest/registry.json exists)
    const governed = folders.find((f) =>
      fs.existsSync(path.join(f.uri.fsPath, '.wildwest', 'registry.json')),
    );
    const startDir = (governed ?? folders[0]).uri.fsPath;
    try {
      const root = execFileSync('git', ['rev-parse', '--show-toplevel'], {
        cwd: startDir,
        encoding: 'utf8',
      }).trim();
      // resolve to main checkout root (worktrees share the same git dir)
      // git-common-dir is absolute in a linked worktree (/path/.git), relative in the main one (.git)
      const gitCommonDir = execFileSync('git', ['-C', root, 'rev-parse', '--git-common-dir'], {
        encoding: 'utf8',
      }).trim();
      const mainRoot = path.isAbsolute(gitCommonDir)
        ? gitCommonDir.replace(/\/\.git$/, '')
        : root;
      this.repoRoot = mainRoot;
      return this.repoRoot;
    } catch {
      return null;
    }
  }

  list(): Worktree[] {
    const root = this.getRepoRoot();
    if (!root) return [];
    try {
      const raw = execFileSync('git', ['worktree', 'list', '--porcelain'], {
        cwd: root,
        encoding: 'utf8',
      });
      return this.parse(raw);
    } catch {
      return [];
    }
  }

  getHeartbeatWorktree(): Worktree | null {
    return this.list().find((w) => w.isHeartbeat) ?? null;
  }

  private parse(raw: string): Worktree[] {
    const worktrees: Worktree[] = [];
    const blocks = raw.trim().split(/\n\n+/);
    for (const block of blocks) {
      const lines = block.trim().split('\n');
      const worktreeLine = lines.find((l) => l.startsWith('worktree '));
      const branchLine = lines.find((l) => l.startsWith('branch '));
      if (!worktreeLine) continue;
      const wtPath = worktreeLine.replace('worktree ', '').trim();
      const branch = branchLine
        ? branchLine.replace('branch refs/heads/', '').trim()
        : '(detached)';
      worktrees.push({
        path: wtPath,
        branch,
        isHeartbeat: path.basename(wtPath) === '_heartbeat' || branch === '_heartbeat',
        isMain: worktrees.length === 0, // first entry from git worktree list is always main
      });
    }
    return worktrees;
  }
}
