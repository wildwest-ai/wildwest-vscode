/**
 * Session Export Pipeline — Utilities
 * 
 * Helper functions for wwuid generation, padding, etc.
 */

import { v5 as uuidv5 } from 'uuid';
import * as os from 'os';

/**
 * Single WW namespace for all entity types.
 * Type is baked into the hash input, so IDs are globally unique across types.
 */
export const WW_NAMESPACE = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';

/** Valid entity types for wwuid generation */
export type WwuidType = 'session' | 'device' | 'memo' | 'town' | 'county' | 'territory';

/**
 * Generate a deterministic wwuid (Wild West Universal ID)
 * 
 * `type` is baked into the hash input, guaranteeing global uniqueness across
 * entity types even within the same namespace. Same (type, ...parts) always
 * produces the same wwuid — idempotent across runs and devices.
 * 
 * @param type   Entity type ('session', 'device', 'memo', 'town', ...)
 * @param parts  Discriminating parts unique to this entity
 * @returns UUIDv5 string
 * 
 * @example
 *   generateWwuid('session', 'cpt', 'abc123')   // session ID
 *   generateWwuid('device',  'macbook-pro')      // device ID
 *   generateWwuid('memo',    'TM', 'CD', '20260508-1707Z', 'release-done') // memo ID
 *   generateWwuid('town',    'wildwest-vscode')  // town ID
 */
export function generateWwuid(type: WwuidType, ...parts: string[]): string {
  const input = `${type}:${parts.join(':')}`;
  return uuidv5(input, WW_NAMESPACE);
}

/**
 * @deprecated Use generateWwuid('session', tool, tool_sid) instead.
 * Kept for backward compatibility during migration.
 */
export function generateWwsid(tool: string, tool_sid: string): string {
  return generateWwuid('session', tool, tool_sid);
}

/**
 * @deprecated Use generateWwuid('device', hostname) instead.
 * Kept for backward compatibility during migration.
 */
export function generateDeviceId(): string {
  return generateWwuid('device', os.hostname());
}

/**
 * Pad an integer to 8 digits for consistent packet naming
 * 
 * @param value Integer to pad
 * @returns Padded string (e.g., '00000042')
 */
export function padSequence(value: number): string {
  return value.toString().padStart(8, '0');
}

/**
 * Generate packet filename
 * 
 * Format: <wwuid>-<seq_from_padded>-<seq_to_padded>.json
 * 
 * @param wwuid Wildwest universal ID for the session
 * @param seq_from First turn index in packet
 * @param seq_to Last turn index in packet
 * @returns Filename (no path)
 */
export function generatePacketFilename(wwuid: string, seq_from: number, seq_to: number): string {
  return `${wwuid}-${padSequence(seq_from)}-${padSequence(seq_to)}.json`;
}

/**
 * Extract sequence range from packet filename
 * 
 * @param filename Packet filename
 * @returns { seq_from, seq_to } or null if parsing fails
 */
export function parsePacketFilename(
  filename: string
): { seq_from: number; seq_to: number } | null {
  const match = filename.match(/^.+-(\d{8})-(\d{8})\.json$/);
  if (!match) return null;
  return {
    seq_from: parseInt(match[1], 10),
    seq_to: parseInt(match[2], 10),
  };
}

/**
 * Get cursor type for a given tool
 * 
 * @param tool Tool code ('cpt', 'cld', 'ccx')
 * @returns Cursor type ('request_id', 'message_id', 'line_offset')
 */
export function getCursorType(tool: string): 'message_id' | 'request_id' | 'line_offset' {
  switch (tool) {
    case 'cld':
      return 'message_id';
    case 'cpt':
      return 'request_id';
    case 'ccx':
      return 'line_offset';
    default:
      throw new Error(`Unknown tool: ${tool}`);
  }
}
