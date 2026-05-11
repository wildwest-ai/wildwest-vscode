# Draft Wire Creation Guide

**Purpose:** Documentation for AI models and developers to create draft wires that integrate with the Wild West telegraph system.

---

## Quick Overview

A **draft wire** is a JSON file stored in the territory-level SSOT (Single Source of Truth) at `~/wildwest/telegraph/flat/` with status `"draft"`. Draft wires can be reviewed, edited, sent, or archived through the Telegraph panel UI.

> **⚠️ CRITICAL: Write to `~/wildwest/telegraph/flat/` — NOT `.wildwest/telegraph/flat/`**
> 
> The Telegraph panel reads from the **territory** flat directory (`~/wildwest/telegraph/flat/`), which is the global SSOT for all scopes. Writing to the town-local `.wildwest/telegraph/flat/` will NOT appear in the panel.

---

## Schema v2 FlatWire Structure

All wires use **schema_version: "2"** and follow this JSON structure:

```json
{
  "schema_version": "2",
  "wwuid": "wire-<unique-identifier>",
  "wwuid_type": "wire",
  "from": "TM(wildwest-vscode)",
  "to": "CD(RSn)",
  "type": "status-update",
  "date": "2026-05-11T00:56:42Z",
  "subject": "short-kebab-case-subject",
  "status": "draft",
  "body": "Wire body text. Can be multi-line.",
  "filename": "20260511-0056Z-to-CD(RSn)-from-TM(wildwest-vscode)--short-subject.json",
  "status_transitions": [
    {
      "status": "draft",
      "timestamp": "2026-05-11T00:56:42Z",
      "repos": ["vscode"]
    }
  ]
}
```

---

## Field Definitions

| Field | Type | Example | Notes |
|-------|------|---------|-------|
| `schema_version` | string | `"2"` | Always `"2"` for current version |
| `wwuid` | string | `"wire-test-draft-20260511-0056Z"` | Unique wire identifier. Used as flat/ filename. |
| `wwuid_type` | string | `"wire"` | Always `"wire"` |
| `from` | string | `"TM(wildwest-vscode)"` | Sender. **Must be `Role(alias)` format** — bare role (`TM`) will NOT appear in Outbox. Channel suffix optional. |
| `to` | string | `"CD(RSn)"` | Recipient. Format: `Role` or `Role(dyad)` or `Role(dyad).Channel` |
| `type` | string | `"status-update"` | Wire type: `status-update`, `assignment`, `ack`, `question`, etc. |
| `date` | string | `"2026-05-11T00:56:42Z"` | ISO 8601 timestamp (UTC). No milliseconds. |
| `subject` | string | `"test-draft"` | Short identifier. Use kebab-case. |
| `status` | string | `"draft"` | Status: `draft`, `pending`, `sent`, `delivered`, `archived` |
| `body` | string | `"Wire message..."` | Multi-line text content |
| `filename` | string | `"20260511-0056Z-to-..."` | Telegraph filename format: `YYYYMMDD-HHMMz-to-<to>-from-<from>--<subject>.json` |
| `status_transitions` | array | (see below) | Status history with timestamps |
| `delivered_at` | string (optional) | `"2026-05-11T01:00:00Z"` | Set when wire is delivered. ISO 8601. |
| `re` | string (optional) | `"ack-wire-filename"` | Reference to original wire if this is an ack or reply |
| `original_wire` | string (optional) | `"original-filename"` | Original wire filename if this is a reply |

---

## Status Transitions Array

Each status transition records when the wire changed state:

```json
"status_transitions": [
  {
    "status": "draft",
    "timestamp": "2026-05-11T00:56:42Z",
    "repos": ["vscode"]
  },
  {
    "status": "pending",
    "timestamp": "2026-05-11T00:57:15Z",
    "repos": ["vscode"]
  },
  {
    "status": "delivered",
    "timestamp": "2026-05-11T00:58:00Z",
    "repos": ["vscode"]
  }
]
```

- **status**: The new status (`draft` → `pending` → `sent` → `delivered`, etc.)
- **timestamp**: ISO 8601 UTC time when the transition occurred
- **repos**: Array of repository identifiers that recorded this transition (e.g., `["vscode"]`)

---

## Creating a Draft Wire

### Step 1: Generate Identifiers

```bash
iso=$(date -u +"%Y-%m-%dT%H:%M:%SZ")        # e.g., 2026-05-11T00:56:42Z
ts=$(date -u +"%Y%m%d-%H%MZ")               # e.g., 20260511-0056Z
wwuid="wire-<purpose>-${ts}"                # e.g., wire-test-draft-20260511-0056Z
telegraph_filename="${ts}-to-CD(RSn)-from-TM(wildwest-vscode)--subject.json"
flatfile=~/wildwest/telegraph/flat/${wwuid}.json   # ← TERRITORY flat/, NOT .wildwest/telegraph/flat/
```

### Step 2: Create the JSON File

```bash
cat > "$flatfile" <<'EOF'
{
  "schema_version": "2",
  "wwuid": "wire-test-draft-20260511-0056Z",
  "wwuid_type": "wire",
  "from": "TM(wildwest-vscode)",
  "to": "CD(RSn)",
  "type": "status-update",
  "date": "2026-05-11T00:56:42Z",
  "subject": "test-draft",
  "status": "draft",
  "body": "Testing draft wire creation and send workflow.",
  "filename": "20260511-0056Z-to-CD(RSn)-from-TM(wildwest-vscode)--test-draft.json",
  "status_transitions": [
    {
      "status": "draft",
      "timestamp": "2026-05-11T00:56:42Z",
      "repos": ["vscode"]
    }
  ]
}
EOF
```

### Step 3: Verify

```bash
ls -l "$flatfile"
cat "$flatfile"
```

---

## File Naming Convention

### Flat Directory Storage
- **Location:** `~/wildwest/telegraph/flat/` ← **TERRITORY level** (global SSOT)
- **NOT:** `.wildwest/telegraph/flat/` ← town-local; Telegraph panel does NOT read this
- **Filename:** `${wwuid}.json` (e.g., `wire-test-draft-20260511-0056Z.json`)
- **Reason:** Flat/ is the territory SSOT; files are indexed by wwuid for fast lookup

### Telegraph Filename (stored in wire JSON)
- **Format:** `YYYYMMDD-HHMMz-to-<to>-from-<from>--<subject>.json`
- **Example:** `20260511-0056Z-to-CD(RSn)-from-TM(wildwest-vscode).Cld--test-draft.json`
- **Purpose:** Human-readable reference; used when copying to local outbox/ for delivery

---

## Address Formats

### `from` Field (Sender)
- **MUST use `Role(alias)` format** — the panel matches `from` against the workspace alias
- `TM(wildwest-vscode)` ✅ — Town marshal of wildwest-vscode (CORRECT)
- `TM(wildwest-vscode).Cld` ✅ — with channel suffix (also works)
- `TM` ❌ — bare role; will NOT appear in Outbox (addressMatchesSelf cannot match it)
- `CD(RSn)` — Chief deputy dyad RSn
- `CD(RSn).Cld` — Chief deputy dyad RSn on Claude channel

### `to` Field (Recipient)
- `TM` — Any town marshal (works for `to`; only `from` requires alias format)
- `TM(wildwest-vscode)` — Specific town (wildwest-vscode)
- `TM(*vscode)` — Town matching pattern `*vscode` (glob)
- `CD(RSn)` — Specific county dyad
- `CD(RSn).Cld` — Specific county dyad on Claude channel

---

## Wire Lifecycle in Telegraph UI

1. **Create Draft**
   - Write JSON to `~/wildwest/telegraph/flat/${wwuid}.json`
   - Status: `"draft"`
   - Appears in Telegraph panel under Outbox → Draft tab

2. **Send (Pending)**
   - Click "Send" button in Telegraph detail pane
   - Status transitions: `draft` → `pending`
   - Wire copied to `.wildwest/telegraph/outbox/` for heartbeat delivery

3. **Heartbeat Delivery**
   - Heartbeat operator picks up wire from outbox/
   - Delivers to destination inbox/
   - Updates flat/ SSOT: status → `"delivered"`
   - Archives original to outbox/history/

4. **Archive**
   - Click "Archive" button in Telegraph detail pane
   - Status: `"archived"`
   - Remains in flat/ but marked as archived
   - No longer shown in default list filters

---

## Common Issues

### Issue: Archive button not working
**Cause:** Wire filename in flat/ directory does not match `${wwuid}.json`  
**Fix:** Ensure the JSON file is named exactly `${wwuid}.json`, not the telegraph filename or any other variant.

### Issue: Draft wire not appearing in Telegraph panel (Outbox > Draft)

**Cause 1: Wrong directory** — wrote to `.wildwest/telegraph/flat/` instead of `~/wildwest/telegraph/flat/`  
**Fix:** Move wire to territory flat/:
```bash
mv .wildwest/telegraph/flat/${wwuid}.json ~/wildwest/telegraph/flat/${wwuid}.json
```

**Cause 2: Wrong `from` format** — used bare role `"TM"` instead of `"TM(alias)"`  
`addressMatchesSelf()` only matches:
- exact identity string (e.g., `TM(RSn)` from `wildwest.identity` setting)
- alias in parens (e.g., `TM(wildwest-vscode)` matching registry alias `wildwest-vscode`)
- glob in parens (e.g., `TM(*vscode)`)
- bare alias as whole field  

Bare `"TM"` matches NONE of these. **Always use `Role(alias)` format for `from`.**

**Fix:** Update the wire JSON `from` field:
```json
"from": "TM(wildwest-vscode)"
```

**Cause 3: JSON malformed**  
**Fix:** Validate syntax: `jq . ~/wildwest/telegraph/flat/${wwuid}.json`

**Cause 4: File renamed incorrectly** — filename must match `wwuid`  
**Fix:** Rename file to exactly `${wwuid}.json`

### Issue: Status transitions show wrong timestamps
**Cause:** Timestamps use milliseconds (`.999Z`) instead of second precision  
**Fix:** Always use `date -u +"%Y-%m-%dT%H:%M:%SZ"` (no milliseconds) for ISO timestamps

---

## Examples

### Example 1: Simple Status Update Draft

```json
{
  "schema_version": "2",
  "wwuid": "wire-bug-report-20260511-0100Z",
  "wwuid_type": "wire",
  "from": "TM(wildwest-vscode).Cld",
  "to": "CD(RSn)",
  "type": "status-update",
  "date": "2026-05-11T01:00:00Z",
  "subject": "bug-report",
  "status": "draft",
  "body": "Found issue with heartbeat delivery in multi-town county. Draft wires not reaching destination.",
  "filename": "20260511-0100Z-to-CD(RSn)-from-TM(wildwest-vscode).Cld--bug-report.json",
  "status_transitions": [
    {
      "status": "draft",
      "timestamp": "2026-05-11T01:00:00Z",
      "repos": ["vscode"]
    }
  ]
}
```

### Example 2: Ack Wire Draft

```json
{
  "schema_version": "2",
  "wwuid": "wire-ack-1507Z-bug-report-20260511-0115Z",
  "wwuid_type": "wire",
  "from": "CD(RSn)",
  "to": "TM(wildwest-vscode)",
  "type": "ack",
  "date": "2026-05-11T01:15:00Z",
  "subject": "ack-1507Z-bug-report",
  "status": "draft",
  "body": "Acknowledged. Bug confirmed. Investigating town-to-county routing in heartbeat operator.",
  "filename": "20260511-0115Z-to-TM(wildwest-vscode)-from-CD(RSn)--ack-1507Z-bug-report.json",
  "re": "20260511-0100Z-to-CD(RSn)-from-TM(wildwest-vscode).Cld--bug-report.json",
  "original_wire": "20260511-0100Z-to-CD(RSn)-from-TM(wildwest-vscode).Cld--bug-report.json",
  "status_transitions": [
    {
      "status": "draft",
      "timestamp": "2026-05-11T01:15:00Z",
      "repos": ["vscode"]
    }
  ]
}
```

---

## Testing with Another AI Model

1. **Read this guide:** Other models should read this file to understand the schema
2. **Create a draft wire:** Follow the "Creating a Draft Wire" section
3. **Place in flat/:** Save to `~/wildwest/telegraph/flat/${wwuid}.json`
4. **Verify in Telegraph:** Refresh the panel to see the draft appear
5. **Test lifecycle:** Try sending and archiving through the UI

---

**Last Updated:** 2026-05-11  
**Format:** Schema v2  
**Applies To:** wildwest-vscode v0.37.7+
