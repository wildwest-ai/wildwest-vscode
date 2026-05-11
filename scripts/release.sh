#!/bin/bash
# Release workflow: docs update → version bump → build → package → [install] → commit
#
# SemVer convention:
#   MAJOR (x.0.0) — breaking changes
#   MINOR (0.x.0) — new features (new commands, participants, tools)
#   PATCH (0.0.x) — bug fixes, security fixes, refactors, chores
# Default bump is --minor. Pass --patch for fix/chore releases.

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

# Step 1: Verify CHANGELOG [Unreleased] has content
echo "📋 Checking CHANGELOG.md [Unreleased] section..."
UNRELEASED_CHECK=$(python3 - "$ROOT_DIR/CHANGELOG.md" << 'PYCHECK'
import sys, re
path = sys.argv[1]
with open(path) as f: content = f.read()
m = re.search(r'^## \[Unreleased\]\n(.*?)(?=^## )', content, re.DOTALL | re.MULTILINE)
if not m: sys.exit(1)
lines = [l for l in m.group(1).splitlines() if l.strip() and not l.strip().startswith('<!--')]
entry = '\n'.join(lines).strip()
if not entry: sys.exit(2)
print(entry)
PYCHECK
)
PY_EXIT=$?
if [ $PY_EXIT -eq 1 ]; then
  echo ""
  echo "  ❌ CHANGELOG.md is missing the ## [Unreleased] section."
  echo ""
  exit 1
elif [ $PY_EXIT -eq 2 ] || [ -z "$UNRELEASED_CHECK" ]; then
  echo ""
  echo "  ❌ CHANGELOG.md [Unreleased] section is empty."
  echo "     Add a What's New entry under '## [Unreleased]' before releasing."
  echo ""
  exit 1
fi
echo "  ✓ [Unreleased] has content"

# Step 2: Bump version
echo "📦 Bumping $BUMP_TYPE version..."
cd "$ROOT_DIR"
npm version "$BUMP_TYPE" --no-git-tag-v

# Step 3: Promote CHANGELOG [Unreleased] → versioned entry
echo "📋 Promoting CHANGELOG.md..."
NEW_VERSION=$(jq -r '.version' "$ROOT_DIR/package.json")
RELEASE_DATE=$(date -u +"%Y-%m-%d")
python3 - "$NEW_VERSION" "$RELEASE_DATE" "$ROOT_DIR/CHANGELOG.md" << 'PYEOF'
import sys, re

version, release_date, path = sys.argv[1], sys.argv[2], sys.argv[3]
with open(path) as f:
    changelog = f.read()

m = re.search(r'^## \[Unreleased\]\n(.*?)(?=^## )', changelog, re.DOTALL | re.MULTILINE)
if not m:
    print('ERROR: [Unreleased] section not found', file=sys.stderr)
    sys.exit(1)
body = m.group(1)
content_lines = [l for l in body.splitlines() if l.strip() and not l.strip().startswith('<!--')]
entry = '\n'.join(content_lines).strip()
if not entry:
    print('ERROR: [Unreleased] is empty', file=sys.stderr)
    sys.exit(1)

fresh_unreleased = (
    '## [Unreleased]\n\n'
    '<!-- Write your What\'s New entry here before running release.sh -->\n\n'
)
versioned_entry = f'## [{version}] - {release_date}\n\n{entry}\n\n'
new_changelog = changelog.replace(m.group(0), fresh_unreleased + versioned_entry)
with open(path, 'w') as f:
    f.write(new_changelog)
print(f'  ✓ CHANGELOG promoted: [Unreleased] → [{version}] - {release_date}')
PYEOF

if [ $? -ne 0 ]; then
  echo "❌ CHANGELOG promotion failed. Aborting."
  exit 1
fi

# Step 4: Build
echo "🏗️  Building extension..."
npm run esbuild

# Step 5: Install (ensure deps are current)
echo "📦 Running npm install..."
npm install

# Step 6: Compile & test
echo "🧪 Compiling TypeScript..."
npm run compile

# Step 7: Package extension
echo "📦 Packaging extension (.vsix)..."
npm run package -- --no-dependencies --out build/

# Step 8: Install extension to VSCode (optional, requires --install flag)
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

# Step 9: Commit
echo "💾 Committing changes..."
NEW_VERSION=$(jq -r '.version' package.json)
git add -A
git commit -m "Release v$NEW_VERSION"

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
