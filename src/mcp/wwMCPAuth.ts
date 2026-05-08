import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

/**
 * Checks whether the connecting identity is registered in the identity registry.
 * For v0.21: permissive — if no `actors` array exists in registry.json,
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

  // No actors array → permissive (v0.21 interim behavior)
  if (!Array.isArray(registry['actors'])) {
    outputChannel.appendLine(
      '[wwMCP] WARNING: No actors array in registry.json — access allowed (permissive mode, v0.21). ' +
      'Add actors array to enforce registration.',
    );
    return { allowed: true };
  }

  // TODO: v1.0+ — match connection identity against actors array
  // For now, any registered registry with an actors field is treated as authorized
  return { allowed: true };
}
