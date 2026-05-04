import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

export async function initTown(outputChannel: vscode.OutputChannel): Promise<void> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    vscode.window.showErrorMessage('Wild West: no workspace folder open.');
    return;
  }

  // ── Folder selection — always show picker so user confirms the target ─────
  const pick = await vscode.window.showQuickPick(
    folders.map((f) => ({ label: f.name, description: f.uri.fsPath, folder: f })),
    { placeHolder: 'Initialize which repo as a Wild West town?' },
  );
  if (!pick) return;
  const cwd = pick.folder.uri.fsPath;

  // ── Verify git repo ───────────────────────────────────────────────────────
  let repoRoot: string;
  try {
    repoRoot = execSync('git rev-parse --show-toplevel', { cwd, encoding: 'utf8' }).trim();
  } catch {
    vscode.window.showErrorMessage('Wild West: selected folder is not a git repository.');
    return;
  }

  const repoName = path.basename(repoRoot);
  const wildwestDir = path.join(repoRoot, '.wildwest');
  const log = (msg: string) => outputChannel.appendLine(`[initTown] ${msg}`);

  // ── Already initialized ───────────────────────────────────────────────────
  if (fs.existsSync(wildwestDir)) {
    vscode.window.showInformationMessage(`Wild West: '${repoName}' is already initialized.`);
    return;
  }

  // ── Run steps with progress notification ──────────────────────────────────
  let success = false;
  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Wild West v0.4.0: Initializing town…', cancellable: false },
    async (progress) => {
      try {
        // Step 1 — directory structure
        progress.report({ message: 'Creating .wildwest/ structure…' });
        for (const sub of ['telegraph', 'scripts', 'docs']) {
          fs.mkdirSync(path.join(wildwestDir, sub), { recursive: true });
          fs.writeFileSync(path.join(wildwestDir, sub, '.gitkeep'), '');
        }
        log('created .wildwest/ directory structure');

        // Step 2 — registry.json identity block
        progress.report({ message: 'Creating registry.json…' });
        const wwuid = `town-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
        let remote = '';
        try {
          remote = execSync('git config --get remote.origin.url', { cwd: repoRoot, encoding: 'utf8' }).trim();
        } catch { /* no remote set */ }

        const registry = {
          scope: 'town',
          wwuid,
          alias: repoName,
          remote: remote || null,
          mcp: null,
          createdAt: new Date().toISOString(),
        };

        const registryPath = path.join(wildwestDir, 'registry.json');
        fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2) + '\n');
        log('created registry.json with identity block');

        // Step 3 — _heartbeat branch
        progress.report({ message: 'Setting up _heartbeat branch…' });
        let heartbeatBranchExists = false;
        try {
          execSync('git rev-parse --verify _heartbeat', { cwd: repoRoot, encoding: 'utf8' });
          heartbeatBranchExists = true;
        } catch { /* create it */ }

        if (!heartbeatBranchExists) {
          execSync('git checkout -b _heartbeat', { cwd: repoRoot, encoding: 'utf8' });
          execSync('git checkout -', { cwd: repoRoot, encoding: 'utf8' });
          log('created _heartbeat branch');
        } else {
          log('_heartbeat branch already exists — skipped');
        }

        // Step 4 — _heartbeat worktree
        progress.report({ message: 'Adding _heartbeat worktree…' });
        const worktreePath = path.join(wildwestDir, 'worktrees', '_heartbeat');
        fs.mkdirSync(path.join(wildwestDir, 'worktrees'), { recursive: true });

        try { execSync('git worktree prune', { cwd: repoRoot, encoding: 'utf8' }); } catch { /* ignore */ }

        const wtList = execSync('git worktree list --porcelain', { cwd: repoRoot, encoding: 'utf8' });
        if (!wtList.includes(worktreePath)) {
          execSync(`git worktree add "${worktreePath}" _heartbeat`, { cwd: repoRoot, encoding: 'utf8' });
          log('added _heartbeat worktree at .wildwest/worktrees/_heartbeat/');
        } else {
          log('_heartbeat worktree already exists — skipped');
        }

        // Step 5 — .gitignore
        progress.report({ message: 'Updating .gitignore…' });
        const gitignorePath = path.join(repoRoot, '.gitignore');
        const ignoreEntry = '.wildwest/worktrees/';
        const gitignoreContent = fs.existsSync(gitignorePath)
          ? fs.readFileSync(gitignorePath, 'utf8')
          : '';
        if (!gitignoreContent.includes(ignoreEntry)) {
          const sep = gitignoreContent.endsWith('\n') || gitignoreContent === '' ? '' : '\n';
          fs.writeFileSync(gitignorePath, `${gitignoreContent}${sep}${ignoreEntry}\n`);
          log('added .wildwest/worktrees/ to .gitignore');
        } else {
          log('.gitignore already up to date');
        }

        outputChannel.appendLine('');
        outputChannel.appendLine(`'${repoName}' initialized. Next steps:`);
        outputChannel.appendLine('  1. git add .wildwest/ .gitignore');
        outputChannel.appendLine('  2. git commit');
        outputChannel.appendLine('  3. git push');
        success = true;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        log(`ERROR: ${msg}`);
        vscode.window.showErrorMessage(`Wild West initTown failed: ${msg}`);
        outputChannel.show();
      }
    },
  );

  // ── Toast — fires after progress notification is fully dismissed ──────────
  if (success) {
    const action = await vscode.window.showInformationMessage(
      `Wild West: '${repoName}' initialized.`,
      'View Log',
    );
    if (action === 'View Log') outputChannel.show();
  }
}
