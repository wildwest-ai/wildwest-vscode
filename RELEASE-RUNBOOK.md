# Wild West VSCode Extension — Release Runbook

**Purpose:** Step-by-step guide for releasing a new version of the wildwest-vscode extension.

**Scope:** This runbook covers patch, minor, and major releases with full testing, packaging, installation, and git operations.

**Prerequisites:**
- All code changes committed and pushed to main branch
- No uncommitted changes in working directory
- Write access to GitHub repository
- VS Code installed locally with extension development environment
- Node.js 18+ and npm installed

---

## Pre-Release Checklist

Before starting the release process:

- [ ] **Code review complete** — All changes approved and merged to main
- [ ] **Tests passing** — `npm test` runs without failures
- [ ] **Build compiles** — `npm run esbuild` succeeds
- [ ] **Git status clean** — `git status` shows no uncommitted changes
- [ ] **Branch is main** — `git branch` confirms you're on main
- [ ] **Latest from remote** — `git pull origin main` to ensure local is up-to-date
- [ ] **Changelog drafted** — Know what features/fixes to document

---

## Release Steps

### 1. Determine Version Bump

```bash
# View current version
cat package.json | grep '"version"'

# Choose bump type:
# - --patch    (0.37.7 → 0.37.8)  Bug fixes, security patches, refactors
# - --minor    (0.37.7 → 0.38.0)  New features, backwards-compatible
# - --major    (0.37.7 → 1.0.0)   Breaking changes, incompatible API
```

**SemVer Rules:**
- `PATCH (0.0.x)` — bug fixes, security fixes, refactors, chores (no new features)
- `MINOR (0.x.0)` — new features, backwards-compatible (new commands, participants)
- `MAJOR (x.0.0)` — breaking changes, incompatible API

### 2. Update README.md (BEFORE running release)

**IMPORTANT:** Update README while package.json still has the CURRENT version.

1. Do NOT change the "Current version:" line yet
2. Add a NEW entry to "What's New" section for the CURRENT version
3. The release script will validate that README mentions the current version before bumping

```markdown
**Current version:** v0.37.8      ← DO NOT CHANGE THIS YET

---

## What's New

**v0.37.8** — [ONE-LINE DESCRIPTION]. [DETAILS].    ← ADD THIS ENTRY NOW

**v0.37.7** — [Previous version entry...]
```

**Format:**
- Start with version number: `**vX.Y.Z**` (use CURRENT version from package.json)
- One-line summary of main change
- Bullet points or short sentences for details
- Link-friendly (avoid special chars in subject lines)

**Example:**
```markdown
**v0.37.8** — Bug fix: heartbeat now reconciles wires to destination scope SSOT. 
When delivering from town outbox to county inbox, heartbeat also creates the wire 
in county's `flat/` directory (SSOT). Fixes: wires invisible at destination scope 
in Telegraph panel because they only existed in legacy `inbox/` directory.
```

### 3. Run Release Script

The release script handles version bumping, building, packaging, and committing.

```bash
cd /Users/reneyap/wildwest/counties/wildwest-ai/wildwest-vscode

# For patch release (default without --patch, but explicit is clearer)
npm run release -- --patch

# For minor release
npm run release -- --minor

# For major release
npm run release -- --major
```

**What the script does:**
1. ✅ Validates README.md contains current version
2. ✅ Bumps `package.json` version
3. ✅ Runs `npm run esbuild` (sourcemap build)
4. ✅ Runs `npm install` (audit dependencies)
5. ✅ Runs `npm run compile` (TypeScript check)
6. ✅ Runs `npm run package` (creates `.vsix`)
7. ✅ Creates local git commit: "Release vX.Y.Z"
8. ⏸️ **WAITS FOR AUTHORIZATION** (manual push required)

**Expected output:**
```
✅ Release v0.37.8 complete!

⚠️  AUTHORIZATION REQUIRED:
   Ready to push to remote? Send explicit approval:
   'git push origin main && git tag v0.37.8 && git push origin v0.37.8'
```

### 4. Install Extension Locally

```bash
code --install-extension build/wildwest-vscode-0.37.8.vsix --force
```

**Verification:**
- VS Code status bar shows: `📦 v0.37.8`
- Extension icon/title updates in activity bar
- No error messages in extension output channel

### 5. Perform Local Testing

Before pushing to remote, verify the extension works:

```bash
# Test command availability
# In VS Code Command Palette (Ctrl/Cmd+Shift+P):
#   - "Wild West: Status"          → Shows liveness
#   - "Wild West: Open Telegraph"  → Panel opens
#   - "@wildwest"                  → Copilot Chat participant loads

# Test heartbeat (if applicable)
# Check output channel:
#   - View > Output > Wild West
#   - Should show heartbeat ticks every N seconds
#   - No ERROR messages

# Test core features (scope-specific)
# - Telegraph panel: read/compose wires
# - Session export: verify chat export captures sessions
# - Heartbeat: verify delivery/status updates
```

**If issues found:**
- Do NOT proceed to remote push
- Roll back with: `git reset --hard HEAD~1 && git tag -d vX.Y.Z`
- Fix issues, commit, and restart release

### 6. Push and Tag Remote

**Once satisfied with local testing:**

```bash
git push origin main && git tag v0.37.8 && git push origin v0.37.8
```

**What this does:**
1. Pushes main branch to GitHub
2. Creates local tag `v0.37.8`
3. Pushes tag to GitHub (creates release)

**Verification:**
```bash
git log --oneline -5
git tag | tail -5
git status  # Should show "up to date with 'origin/main'"
```

### 7. Verify Remote Release

```bash
# Check GitHub release page
# https://github.com/wildwest-ai/wildwest-vscode/releases/tag/v0.37.8
# Should show:
#   - Tag name: v0.37.8
#   - Release title: Release v0.37.8
#   - Changelog from commit message
```

### 8. Update README "Current version" Line (AFTER release)

**⚠️ GIT OPERATION ONLY — DO NOT REBUILD OR REPACKAGE**

The VSIX was already built and packaged in Step 3. This step updates only the git repo documentation.

```bash
# Edit README.md:
# OLD: **Current version:** v0.37.9
# NEW: **Current version:** v0.37.10

git add README.md
git commit -m "Sync README version to v0.37.10"
git push origin main
```

**CRITICAL:** Do NOT run npm run esbuild or npx vsce package here. The VSIX is already correct from Step 3.

---

## Post-Release Tasks

### Update Session Memory (if working in Wild West framework)

```bash
# If in wildwest-vscode town scope:
# 1. Create telegraph memo documenting release
# 2. Log in DONE.md: "✓ v0.37.8 released"
# 3. Update TODO.md: remove completed items, add blockers
```

### Publish to VSCode Marketplace (Optional)

If configured for automated publishing:
```bash
npm run vscode:publish
```

Otherwise, manual publish via VSCode publisher dashboard:
- Upload `.vsix` file from `build/`
- Add changelog from README.md
- Set visibility (public/private)

### Rollback (If Release Goes Wrong)

```bash
# If remote push NOT yet done:
git reset --hard HEAD~1
git tag -d v0.37.8

# If remote push already done (mistake caught post-push):
git revert HEAD                    # Create revert commit
git tag v0.37.8-reverted          # Mark reverted
git push origin main v0.37.8-reverted
# Manual cleanup: delete v0.37.8 tag from GitHub

# Install previous extension:
code --install-extension build/wildwest-vscode-0.37.7.vsix --force
```

---

## Verification Checklist (Post-Release)

- [ ] **Version bumped** — `package.json` shows X.Y.Z
- [ ] **README updated** — Current version + changelog entry
- [ ] **VSIX built** — `build/wildwest-vscode-X.Y.Z.vsix` exists (270+ KB)
- [ ] **Extension installed** — VS Code status bar shows `📦 vX.Y.Z`
- [ ] **Git committed** — `git log` shows "Release vX.Y.Z"
- [ ] **Git tagged** — `git tag | grep vX.Y.Z` shows tag
- [ ] **Remote synced** — `git status` shows "up to date with 'origin/main'"
- [ ] **GitHub release** — Release page exists at `github.com/.../releases/tag/vX.Y.Z`
- [ ] **Core features work** — Telegraph panel opens, heartbeat runs (if applicable)

---

## Troubleshooting

### README.md Validation Fails

**Error:** `README.md does not mention vX.Y.Z`

**Solution:**
1. Edit `README.md`
2. Add entry to "What's New" section
3. Update "Current version" line to match `package.json`
4. Save and retry `npm run release`

### Build Compilation Fails

**Error:** `tsc: error TS2345...`

**Solution:**
1. Fix TypeScript error in source file
2. Run `npm run compile` to verify
3. Commit fix: `git add . && git commit -m "Fix: TypeScript error"`
4. Restart release from step 1

### Package Script Fails

**Error:** `vsce package failed...`

**Solution:**
1. Check `package.json` extension manifest (displayName, etc.)
2. Ensure `dist/extension.js` exists from esbuild step
3. Run `npm run vscode:prepublish` manually
4. Retry `npm run release`

### Git Push Fails (Network)

**Error:** `fatal: unable to access 'https://github.com/...'`

**Solution:**
1. Check network connection: `ping github.com`
2. Check git credentials: `git config --global user.email` and `user.name`
3. Manually run: `git push origin main`
4. Then: `git tag v0.37.8 && git push origin v0.37.8`

### Local Testing Finds Bug

**Error:** Feature doesn't work in newly installed extension

**Solution:**
1. Revert local release: `git reset --hard HEAD~1 && git tag -d vX.Y.Z`
2. Fix bug in source code
3. Test: `npm run esbuild && code --install-extension build/...`
4. Commit fix separately
5. Restart release process
### Rebuilt VSIX After Step 8 (README Version Update)

**Problem:** After updating README version line in Step 8, you rebuilt the extension with `npm run esbuild` and repackaged it. This overwrites the correct VSIX with an incorrect one containing the old README.

**Root Cause:** Step 8 is a **git-only operation**. The VSIX was already correctly packaged in Step 3.

**Prevention:**
- Step 8 updates README for **git documentation only**
- Do NOT run `npm run esbuild`, `npm run package`, or `npx vsce package` in Step 8
- The installed extension is correct; git history stays in sync

**If Already Done:**
1. Repackage the VSIX: `npm run esbuild && npx vsce package --no-dependencies --out build/`
2. Reinstall: `code --install-extension build/wildwest-vscode-X.Y.Z.vsix --force`
3. Verify: Check that README shows correct version in extension Details
---

## Quick Reference

### One-Liner Release (Patch)

```bash
cd wildwest-vscode && npm run release -- --patch
```

### Check Current Version

```bash
cat package.json | grep '"version"' && head -5 README.md | grep "Current version"
```

### View Release Artifacts

```bash
ls -lh build/wildwest-vscode-*.vsix | tail -1
git log --oneline -3
git tag | tail -3
```

### Clean Build

```bash
npm run esbuild && npm run compile && npm run package
```

---

## Contact & Support

**Release Issues:**
- Check this runbook's troubleshooting section
- Review `scripts/release.sh` for automation details
- Consult `README.md` for feature-specific information

**Code Issues:**
- File GitHub issue: `https://github.com/wildwest-ai/wildwest-vscode/issues`
- Reference version number and reproduction steps

---

**Last Updated:** 2026-05-10  
**Runbook Version:** 1.0.0  
**Applies to:** wildwest-vscode v0.37.8+
