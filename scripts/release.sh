#!/bin/bash
# Release workflow: docs update → version bump → build → package → [install] → commit

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

# Parse arguments
INSTALL_EXTENSION=false
BUMP_TYPE="minor"  # default to minor

while [[ $# -gt 0 ]]; do
  case $1 in
    --install)
      INSTALL_EXTENSION=true
      shift
      ;;
    --patch)
      BUMP_TYPE="patch"
      shift
      ;;
    --minor)
      BUMP_TYPE="minor"
      shift
      ;;
    *)
      shift
      ;;
  esac
done

echo "🚀 Starting release workflow in $ROOT_DIR"

# Step 1: Verify README.md is current
echo "📝 Checking README.md..."
CURRENT_VERSION=$(jq -r '.version' "$ROOT_DIR/package.json")
if grep -q "$CURRENT_VERSION" "$ROOT_DIR/README.md"; then
  echo "  ✓ README.md mentions v$CURRENT_VERSION"
else
  echo ""
  echo "  ❌ README.md does not mention v$CURRENT_VERSION"
  echo "     Update README.md (What's New section + Current version line) before releasing."
  echo ""
  exit 1
fi

# Step 2: Bump version
echo "📦 Bumping $BUMP_TYPE version..."
cd "$ROOT_DIR"
npm version "$BUMP_TYPE" --no-git-tag-v

# Step 3: Build
echo "🏗️  Building extension..."
npm run esbuild

# Step 4: Install (ensure deps are current)
echo "📦 Running npm install..."
npm install

# Step 5: Compile & test
echo "🧪 Compiling TypeScript..."
npm run compile

# Step 6: Package extension
echo "📦 Packaging extension (.vsix)..."
npm run package -- --no-dependencies --out build/

# Step 7: Install extension to VSCode (optional, requires --install flag)
if [ "$INSTALL_EXTENSION" = true ]; then
  echo "🔌 Installing extension to VSCode..."
  NEW_VERSION=$(jq -r '.version' package.json)
  VSIX_FILE="$ROOT_DIR/build/wildwest-vscode-$NEW_VERSION.vsix"
  if [ -f "$VSIX_FILE" ]; then
    code --install-extension "$VSIX_FILE"
    echo "  ✓ Extension installed: $VSIX_FILE"
  else
    echo "  ⚠️  VSIX file not found: $VSIX_FILE"
  fi
else
  echo "⏭️  Skipping extension install (use --install flag to enable)"
fi

# Step 8: Commit
echo "💾 Committing changes..."
NEW_VERSION=$(jq -r '.version' package.json)
git add -A
git commit -m "Release v$NEW_VERSION: telegraph scripts, schema_version guard, registry v2 migration"

echo "✅ Release v$NEW_VERSION complete!"
echo ""
echo "⚠️  AUTHORIZATION REQUIRED:"
echo "   Ready to push to remote? Send explicit approval:"
echo "   'git push origin main && git tag v$NEW_VERSION && git push origin v$NEW_VERSION'"
echo ""
echo "📝 Usage:"
echo "   bash scripts/release.sh                    (minor bump, build and package only)"
echo "   bash scripts/release.sh --patch            (patch bump, build and package only)"
echo "   bash scripts/release.sh --minor            (minor bump, build and package only)"
echo "   bash scripts/release.sh --patch --install  (patch bump, build, package, and install)"
echo "   bash scripts/release.sh --install          (minor bump, build, package, and install)"
