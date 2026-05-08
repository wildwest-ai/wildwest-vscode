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

## VSIX Artifacts

`build/*.vsix` files are **not tracked in git** (excluded via `.gitignore`).

- They are built locally by `npm run esbuild && npx vsce package`.
- To share a release, attach the VSIX to a **GitHub Release** manually:
  1. Push the tag: `git push origin vX.Y.Z`
  2. Go to GitHub → Releases → Draft a new release → select the tag
  3. Attach `build/wildwest-vscode-X.Y.Z.vsix` as a release asset
  4. Publish

For local install only, `code --install-extension build/wildwest-vscode-X.Y.Z.vsix --force` is sufficient.

---

Last updated: 2026-05-08 — VSIX artifacts removed from git; GitHub Releases workflow documented
