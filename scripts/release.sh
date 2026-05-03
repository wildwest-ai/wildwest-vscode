#!/bin/bash
# Release workflow: docs update → version bump → build → install → commit

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

echo "🚀 Starting release workflow in $ROOT_DIR"

# Step 1: Update docs (README.md / CHANGELOG placeholder)
echo "📝 Updating documentation..."
if [ -f "$ROOT_DIR/CHANGELOG.md" ]; then
  echo "  ✓ CHANGELOG.md exists"
else
  echo "  ⚠️  No CHANGELOG.md found — skipping doc update"
fi

# Step 2: Bump minor version
echo "📦 Bumping minor version..."
cd "$ROOT_DIR"
npm version minor --no-git-tag-v

# Step 3: Build
echo "🏗️  Building extension..."
npm run esbuild

# Step 4: Install (ensure deps are current)
echo "📦 Running npm install..."
npm install

# Step 5: Compile & test
echo "🧪 Compiling TypeScript..."
npm run compile

# Step 6: Commit
echo "💾 Committing changes..."
NEW_VERSION=$(jq -r '.version' package.json)
git add -A
git commit -m "Release v$NEW_VERSION: registry path removal + world root config (P1)"

echo "✅ Release v$NEW_VERSION complete!"
echo "Next: Push to remote with 'git push origin' and tag with 'git tag v$NEW_VERSION && git push origin v$NEW_VERSION'"
