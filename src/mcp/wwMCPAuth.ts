import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

/**
 * Checks whether the connecting identity is registered in the identity registry.
 * For v0.21: permissive — if no `identities` array exists in registry.json,
 * access is allowed (with a warning) to avoid blocking all MCP use before
 * the registry schema is finalized.
 */
export function checkActorAccess(
  rootPath: string,
  outputChannel: vscode.OutputChannel,
): { allowed: boolean; reason?: string } {
  const regPath = path.join(rootPath, '.wildwest', 'registry.json');

  let registry: Record<string, unknown>;
  try {
    registry = JSON.parse(fs.readFileSync(regPath, 'utf8'));
  } catch {
    return { allowed: false, reason: 'registry.json unreadable or missing' };
  }

  // No identities array → permissive (v0.21 interim behavior)
  if (!Array.isArray(registry['identities'])) {
    outputChannel.appendLine(
      '[wwMCP] WARNING: No identities array in registry.json — access allowed (permissive mode, v0.21). ' +
      'Add identities array to enforce registration.',
    );
    return { allowed: true };
  }

  // TODO: v1.0+ — match connection identity against identities array
  // For now, any registered registry with an identities field is treated as authorized
  return { allowed: true };
}
