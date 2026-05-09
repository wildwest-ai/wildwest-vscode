# Wild West Registry Schema

## Overview

The `.wildwest/registry.json` file contains metadata about a Wild West scope (town, county, or territory).

## Schema Version History

| Version | Change |
|---|---|
| v1 | Initial schema — included `path` fields, `name` instead of `alias` |
| v2 | Removed `path` fields (derived from config); `name` → `alias`; added `schema_version` |
| v3 | `actors` → `identities`; entry fields: `actor` → `dyad`, `channel` dropped |

## Full Schema (v3)

```json
{
  "schema_version": "3",
  "scope": "town|county|territory",
  "wwuid": "string",
  "alias": "string",
  "remote": "string|null",
  "mcp": "object|null",
  "identities": [
    {
      "role": "string",
      "dyad": "string"
    }
  ]
}
```

## Field Descriptions

### schema_version
- **Type**: string (`"3"`)
- **Required**: yes
- **Description**: Registry schema version. Auto-migrated on read by the extension.

### scope
- **Type**: enum: `"town" | "county" | "territory"`
- **Required**: yes
- **Description**: Governance scope level. Determines valid roles and authorities.
- **Valid scopes**:
  - `town`: Smallest scope; Mayor, TM, HG roles
  - `county`: Regional scope; S, CD, TM roles
  - `territory`: Largest scope; G, RA roles

### wwuid
- **Type**: string (UUID)
- **Required**: yes
- **Description**: Unique Wild West identifier for this scope. Auto-generated on `wildwest.initTown`.
- **Example**: `"83b09a8d-6587-46bb-9e98-880d56db39b2"`

### alias
- **Type**: string
- **Required**: yes
- **Description**: Alphanumeric identifier for this scope (used in file paths and telegraph routing).
  - In v0.18.0+, supports glob-style pattern matching in `to:` addressing (e.g., `TM(*vscode)` matches alias `wildwest-vscode`).
- **Example**: `"wildwest-vscode"`, `"wildwest-ai"`

### remote
- **Type**: string (URL) | null
- **Required**: no (default: null)
- **Description**: GitHub repository URL associated with this scope.
- **Example**: `"https://github.com/wildwest-ai/wildwest-vscode"`

### mcp
- **Type**: object | null
- **Required**: no (default: null)
- **Description**: Model Context Protocol server configuration (reserved for future use).

### identities (town scope only)
- **Type**: array of identity objects
- **Required**: no (default: `[]`)
- **Description**: Declared operator identities for this town. When non-empty, the extension warns if the active `wildwest.identity` VSCode setting declares a dyad+role not in this roster.
- **Note**: County and territory scopes use `towns`/`counties` arrays instead; they do not use `identities`.

#### Identity Object Shape

```json
{
  "role": "string",
  "dyad": "string"
}
```

- **role** (string): The governance role (e.g., `"TM"`, `"HG"`)
  - Valid roles per scope — town: `Mayor`, `TM`, `HG`
- **dyad** (string): The devPair code (e.g., `"RHk"`, `"RSn"`)
  - Combined with role as `"TM(RHk)"`, `"CD(RSn)"`, etc. in notation

## Example: Town Registry (v3)

```json
{
  "schema_version": "3",
  "scope": "town",
  "wwuid": "83b09a8d-6587-46bb-9e98-880d56db39b2",
  "alias": "wildwest-vscode",
  "remote": "https://github.com/wildwest-ai/wildwest-vscode",
  "mcp": null,
  "identities": [
    {
      "role": "TM",
      "dyad": "RHk"
    }
  ]
}
```

## Example: County Registry (v3)

```json
{
  "schema_version": "3",
  "scope": "county",
  "wwuid": "f8a3b2c1-d4e5-4f6a-9b8c-7d6e5f4a3b2c",
  "alias": "wildwest-ai",
  "remote": null,
  "mcp": null,
  "towns": []
}
```

## Auto-Migration

The extension auto-migrates older registries on read (via `HeartbeatMonitor`):

| From | To | Trigger |
|---|---|---|
| no `schema_version` | v2 | `schema_version` field missing |
| v2 | v3 | `schema_version === "2"` |

Migrations write the updated registry back to disk. No manual intervention needed.

## Notes

- The `identities` array is a roster declaration checked in to git — it documents who is authorized to operate in this scope.
- Actual runtime identity is declared via the `wildwest.identity` VSCode setting (e.g., `"TM(RHk)"`).
- When `identities` is non-empty, the heartbeat warns if the runtime identity is not in the roster.
- When `identities` is empty (default), no roster check is performed.
