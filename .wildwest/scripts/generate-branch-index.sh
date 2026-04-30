#!/usr/bin/env bash
# generate-branch-index.sh — regenerate board/branches/README.md from folder structure
#
# Usage: bash .wildwest/scripts/generate-branch-index.sh [repo-root]
# If repo-root not provided, uses git rev-parse --show-toplevel

set -euo pipefail

REPO_ROOT="${1:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
BOARD_DIR="$REPO_ROOT/.wildwest/board/branches"
OUTPUT="$BOARD_DIR/README.md"

if [[ ! -d "$BOARD_DIR" ]]; then
  echo "Error: $BOARD_DIR not found. Run wildwest.initTown first." >&2
  exit 1
fi

# ── Helpers ────────────────────────────────────────────────────────────────

# Extract a frontmatter-style field from a README.md
# Matches "> **Field:** value" pattern (nx-icouponads convention)
extract_field() {
  local file="$1" field="$2"
  grep -m1 "^\*\*${field}:\*\*\|^> \*\*${field}:\*\*" "$file" 2>/dev/null \
    | sed "s/.*\*\*${field}:\*\* //" | sed 's/^>//; s/^ *//' || echo "—"
}

# Build a table row for a branch
branch_row() {
  local state="$1" branch_path="$2"
  local readme="$branch_path/README.md"
  local branch
  branch=$(basename "$branch_path")

  if [[ ! -f "$readme" ]]; then
    echo "| \`$branch\` | — | — | — |"
    return
  fi

  local status owner created
  status=$(extract_field "$readme" "Status")
  owner=$(extract_field "$readme" "Owner")
  created=$(extract_field "$readme" "Created")

  echo "| \`$branch\` | $status | $owner | $created |"
}

# Build a section table for a given state dir
build_table() {
  local state="$1"
  local state_dir="$BOARD_DIR/$state"

  if [[ ! -d "$state_dir" ]]; then return; fi

  # Collect branch dirs (may be nested: type/branch or flat: branch)
  local branches=()
  while IFS= read -r -d '' dir; do
    if [[ -f "$dir/README.md" ]]; then
      branches+=("$dir")
    fi
  done < <(find "$state_dir" -mindepth 1 -maxdepth 2 -type d -print0 | sort -z)

  if [[ ${#branches[@]} -eq 0 ]]; then
    echo "_None._"
    return
  fi

  echo "| Branch | Status | Owner | Created |"
  echo "|---|---|---|---|"
  for branch_path in "${branches[@]}"; do
    branch_row "$state" "$branch_path"
  done
}

# ── Generate ────────────────────────────────────────────────────────────────

TIMESTAMP=$(date -u '+%Y-%m-%d %H:%M UTC')

# Preserve hand-written header block if it exists (everything before <!-- GENERATED -->)
HEADER_BLOCK=""
if [[ -f "$OUTPUT" ]]; then
  HEADER_BLOCK=$(sed -n '/<!-- GENERATED -->/q;p' "$OUTPUT")
fi

# Default header if none exists
if [[ -z "$HEADER_BLOCK" ]]; then
  HEADER_BLOCK="# Branch Index

> Hand-written section. Add Hot Items, session handoff notes, or standing context here.
> Tables below are generated — do not edit them manually.

<!-- Hot Items (optional) -->
"
fi

cat > "$OUTPUT" <<EOF
${HEADER_BLOCK}
<!-- GENERATED — last regenerated: ${TIMESTAMP} -->
<!-- Run: bash .wildwest/scripts/generate-branch-index.sh -->

---

## 🔄 Active

$(build_table active)

---

## 🟡 Planned

$(build_table planned)

---

## ✅ Merged

$(build_table merged)

---

## ❌ Abandoned

$(build_table abandoned)
EOF

echo "Generated: $OUTPUT"
