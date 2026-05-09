/**
 * Registry Validator
 *
 * Validates `.wildwest/registry.json` against the Wild West schema.
 * Run via `wildwest.validateRegistry` command.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { scopeRoleMap } from './roles/roleRegistry';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RegistryIssue {
  severity: 'error' | 'warn' | 'info';
  field: string;
  message: string;
}

export interface RegistryValidationResult {
  /** true when there are no error-severity issues */
  valid: boolean;
  issues: RegistryIssue[];
}

// ---------------------------------------------------------------------------
// Schema constants
// ---------------------------------------------------------------------------

const VALID_SCOPES = ['town', 'county', 'territory'] as const;
type Scope = (typeof VALID_SCOPES)[number];

// Canonical scope → role mapping — derived from src/roles/roleRegistry.ts.
// Corrections applied per S(R)-approved role-scope-registry.md:
//   - 'Mayor' replaced by 'M' (Phase 0 decision)
//   - 'TM' removed from county row (TM is town-scoped only)
//   - 'DS', 'aCD', 'DM' added as routable roles
const SCOPE_ROLES: Record<Scope, string[]> = scopeRoleMap();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------------------
// Core validation logic (pure, no vscode deps)
// ---------------------------------------------------------------------------

export function validateRegistryData(data: Record<string, unknown>): RegistryValidationResult {
  const issues: RegistryIssue[] = [];

  // ── wwuid ─────────────────────────────────────────────────────────────────
  if (data['wwuid'] === undefined || data['wwuid'] === null || data['wwuid'] === '') {
    issues.push({ severity: 'error', field: 'wwuid', message: 'required field missing' });
  } else if (typeof data['wwuid'] !== 'string') {
    issues.push({ severity: 'error', field: 'wwuid', message: 'must be a string' });
  } else if (!UUID_RE.test(data['wwuid'])) {
    issues.push({ severity: 'warn', field: 'wwuid', message: 'not a standard UUID format (expected xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)' });
  }

  // ── alias ─────────────────────────────────────────────────────────────────
  if (data['alias'] === undefined || data['alias'] === null || data['alias'] === '') {
    issues.push({ severity: 'error', field: 'alias', message: 'required field missing' });
  } else if (typeof data['alias'] !== 'string' || data['alias'].trim() === '') {
    issues.push({ severity: 'error', field: 'alias', message: 'must be a non-empty string' });
  }

  // ── scope ─────────────────────────────────────────────────────────────────
  const scope = data['scope'];
  if (scope === undefined || scope === null || scope === '') {
    issues.push({ severity: 'error', field: 'scope', message: 'required field missing' });
  } else if (!VALID_SCOPES.includes(scope as Scope)) {
    issues.push({
      severity: 'error',
      field: 'scope',
      message: `invalid value "${scope}" — must be one of: ${VALID_SCOPES.join(', ')}`,
    });
  }

  // ── remote ────────────────────────────────────────────────────────────────
  if (data['remote'] !== undefined && data['remote'] !== null && typeof data['remote'] !== 'string') {
    issues.push({ severity: 'warn', field: 'remote', message: 'expected a string URL or null' });
  }

  // ── mcp ───────────────────────────────────────────────────────────────────
  if (data['mcp'] !== undefined && data['mcp'] !== null && (typeof data['mcp'] !== 'object' || Array.isArray(data['mcp']))) {
    issues.push({ severity: 'warn', field: 'mcp', message: 'expected an object or null' });
  }

  // ── identities (schema v3+) ───────────────────────────────────────────────
  if (data['identities'] !== undefined) {
    if (!Array.isArray(data['identities'])) {
      issues.push({ severity: 'error', field: 'identities', message: 'must be an array' });
    } else {
      const validRoles: string[] | null =
        typeof scope === 'string' && VALID_SCOPES.includes(scope as Scope)
          ? SCOPE_ROLES[scope as Scope]
          : null;

      (data['identities'] as unknown[]).forEach((entry, i) => {
        if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
          issues.push({ severity: 'error', field: `identities[${i}]`, message: 'must be an object' });
          return;
        }
        const a = entry as Record<string, unknown>;
        for (const f of ['role', 'dyad'] as const) {
          if (typeof a[f] !== 'string' || (a[f] as string).trim() === '') {
            issues.push({
              severity: 'error',
              field: `identities[${i}].${f}`,
              message: 'required string field missing or empty',
            });
          }
        }
        if (validRoles && typeof a['role'] === 'string' && !validRoles.includes(a['role'])) {
          issues.push({
            severity: 'warn',
            field: `identities[${i}].role`,
            message: `"${a['role']}" is not a valid role for scope "${scope}" — valid roles: ${validRoles.join(', ')}`,
          });
        }
      });
    }
  }

  const valid = issues.every((i) => i.severity !== 'error');
  return { valid, issues };
}

export function validateRegistryFile(registryPath: string): RegistryValidationResult {
  if (!fs.existsSync(registryPath)) {
    return {
      valid: false,
      issues: [{ severity: 'error', field: '(file)', message: `registry.json not found at ${registryPath}` }],
    };
  }
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(fs.readFileSync(registryPath, 'utf8')) as Record<string, unknown>;
  } catch {
    return {
      valid: false,
      issues: [{ severity: 'error', field: '(parse)', message: 'registry.json is not valid JSON' }],
    };
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return {
      valid: false,
      issues: [{ severity: 'error', field: '(root)', message: 'registry.json root must be a JSON object' }],
    };
  }
  return validateRegistryData(data);
}

// ---------------------------------------------------------------------------
// VSCode command handler
// ---------------------------------------------------------------------------

export function runValidateRegistry(outputChannel: vscode.OutputChannel): void {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    vscode.window.showErrorMessage('Wild West: no workspace folder open.');
    return;
  }

  const wwDir = path.join(folders[0].uri.fsPath, '.wildwest');
  const registryPath = path.join(wwDir, 'registry.json');

  outputChannel.show(true);
  outputChannel.appendLine('');
  outputChannel.appendLine('── Registry Validator ──────────────────────────────────────');

  const result = validateRegistryFile(registryPath);

  const ICON: Record<RegistryIssue['severity'], string> = {
    error: '❌',
    warn:  '⚠️ ',
    info:  'ℹ️ ',
  };

  if (result.issues.length === 0) {
    outputChannel.appendLine('✅  registry.json — all checks passed');
  } else {
    for (const issue of result.issues) {
      outputChannel.appendLine(`${ICON[issue.severity]}  ${issue.field}: ${issue.message}`);
    }
  }

  outputChannel.appendLine('────────────────────────────────────────────────────────────');
  const errorCount = result.issues.filter((i) => i.severity === 'error').length;
  const warnCount  = result.issues.filter((i) => i.severity === 'warn').length;

  if (result.valid && result.issues.length === 0) {
    vscode.window.showInformationMessage('Wild West: registry.json is valid ✅');
  } else if (result.valid) {
    vscode.window.showWarningMessage(`Wild West: registry.json has ${warnCount} warning(s) — see output log`);
  } else {
    vscode.window.showErrorMessage(
      `Wild West: registry.json has ${errorCount} error(s), ${warnCount} warning(s) — see output log`,
    );
  }
}
