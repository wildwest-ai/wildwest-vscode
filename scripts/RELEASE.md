# Release Workflow

This script automates the build process for wildwest-vscode but **requires manual push authorization**.

## Usage

```bash
bash scripts/release.sh              # Build and package only
bash scripts/release.sh --install    # Build, package, and install to VSCode
```

## What It Does

1. **Update docs** — Checks for CHANGELOG.md (placeholder for future doc updates)
2. **Bump version** — Runs `npm version minor` (updates package.json + creates git tag)
3. **Build** — Runs `npm run esbuild` (bundles extension)
4. **Install** — Runs `npm install` (ensures dependencies are current)
5. **Compile** — Runs `npm run compile` (validates TypeScript)
6. **Commit** — Git commits all changes with version number in message
7. **STOPS** — Does NOT run `git push`. Requires explicit authorization before push.

## Push Requires Explicit Authorization

After the script completes, it prints:
```
Release v0.X.Y complete!

⚠️  AUTHORIZATION REQUIRED:
   Ready to push to remote? Send explicit approval:
   'git push origin main && git tag vX.Y.Z && git push origin vX.Y.Z'
```

The push must be performed manually by the devPair lead (S(R)) with explicit authorization:
```bash
git push origin main               # Push commit
git push origin v0.X.Y             # Push tag to remote
```

**Push is NOT automated.** No flag or setting will auto-push.

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
