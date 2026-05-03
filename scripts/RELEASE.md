# Release Workflow

This script automates the full release process for wildwest-vscode.

## Usage

```bash
npm run release
```

## What It Does

1. **Update docs** — Checks for CHANGELOG.md (placeholder for future doc updates)
2. **Bump version** — Runs `npm version minor` (updates package.json + creates git tag)
3. **Build** — Runs `npm run esbuild` (bundles extension)
4. **Install** — Runs `npm install` (ensures dependencies are current)
5. **Compile** — Runs `npm run compile` (validates TypeScript)
6. **Commit** — Git commits all changes with version number in message

## Manual Steps After Release

The script will output:
```
Next: Push to remote with 'git push origin' and tag with 'git tag v<VERSION> && git push origin v<VERSION>'
```

Do NOT forget these steps:
```bash
git push origin                    # Push commit
git tag v0.10.0                    # Create local tag
git push origin v0.10.0            # Push tag to remote
```

## If Something Goes Wrong

The script exits on first error (`set -e`). If interrupted:
1. Check git status: `git status`
2. Undo partial changes: `git reset --hard HEAD`
3. Fix the issue
4. Run `npm run release` again

## Future: Automated CHANGELOG

Consider adding a CHANGELOG.md entry in the script before commit step.

---

Last updated: 2026-05-03 — Created to prevent version/build mismatches
