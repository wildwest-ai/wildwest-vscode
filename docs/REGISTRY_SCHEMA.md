# Wild West Registry Schema

## Overview

The `.wildwest/registry.json` file contains metadata about a Wild West scope (town, county, or territory).

## Full Schema

```json
{
  "wwuid": "string",
  "alias": "string",
  "scope": "town|county|territory",
  "remote": "string|null",
  "mcp": "object|null",
  "actors": [
    {
      "role": "string",
      "actor": "string",
      "channel": "string"
    }
  ]
}
```

## Field Descriptions

### wwuid
- **Type**: string (UUID)
- **Required**: yes
- **Description**: Unique World West identifier for this scope. Auto-generated on `wildwest.initTown`.
- **Example**: `"83b09a8d-6587-46bb-9e98-880d56db39b2"`

### alias
- **Type**: string
- **Required**: yes
- **Description**: Alphanumeric identifier for this scope (used in file paths and references). 
  - In v0.18.0+, also used for wildcard pattern matching in telegraph addressing (e.g., `TM(*vscode)` matches alias `wildwest-vscode`).
- **Example**: `"wildwest-vscode"`, `"wildwest-ai"`
- **Pattern matching** (v0.18.0+): Aliases support glob-style matching with `*` (any chars) and `?` (single char)

### scope
- **Type**: enum: `"town" | "county" | "territory"`
- **Required**: yes
- **Description**: Governance scope level. Determines valid roles and authorities.
- **Valid Scopes**:
  - `town`: Smallest scope; Mayor, TM, HG roles
  - `county`: Regional scope; S, CD, TM roles
  - `territory`: Largest scope; G, RA roles

### remote
- **Type**: string (URL) | null
- **Required**: no (default: null)
- **Description**: GitHub repository URL associated with this scope.
- **Example**: `"https://github.com/wildwest-ai/wildwest-vscode"`

### mcp
- **Type**: object | null
- **Required**: no (default: null)
- **Description**: Model Context Protocol server configuration (reserved for future use).

### actors
- **Type**: array of actor objects
- **Required**: no (default: [])
- **Description**: List of declared actors operating in this scope.

#### Actor Object Shape

```json
{
  "role": "string",
  "actor": "string",
  "channel": "string"
}
```

- **role** (string): The governance role (e.g., "TM", "CD", "RA")
  - Valid roles determined by scope (see SCOPE_ROLES in HeartbeatMonitor.ts)
  - town: Mayor, TM, HG
  - county: S, CD, TM
  - territory: G, RA

- **actor** (string): The actor identifier (e.g., "RHk", "RSn")
  - Combined with role as "TM(RHk)", "CD(RSn)", etc.

- **channel** (string): Communication channel or window identifier
  - Allows multiple windows with different actors in same scope
  - Examples: "main", "pr-review", "release"

## Example: Town Registry

```json
{
  "wwuid": "83b09a8d-6587-46bb-9e98-880d56db39b2",
  "alias": "wildwest-vscode",
  "scope": "town",
  "remote": "https://github.com/wildwest-ai/wildwest-vscode",
  "mcp": null,
  "actors": [
    {
      "role": "TM",
      "actor": "RHk",
      "channel": "main"
    }
  ]
}
```

## Example: County Registry

```json
{
  "wwuid": "f8a3b2c1-d4e5-4f6a-9b8c-7d6e5f4a3b2c",
  "alias": "wildwest-ai",
  "scope": "county",
  "remote": null,
  "mcp": null,
  "actors": [
    {
      "role": "CD",
      "actor": "RSn",
      "channel": "main"
    },
    {
      "role": "TM",
      "actor": "RHk",
      "channel": "townhall"
    }
  ]
}
```

## Notes

- The `actors` array is purely informational; it documents who is operating in this scope.
- Actual actor role validation is determined by the `wildwest.actor` VSCode setting at runtime.
- The scope field determines which roles are valid (see SCOPE_ROLES mapping).
