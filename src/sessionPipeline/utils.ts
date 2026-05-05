/**
 * Session Export Pipeline — Utilities
 * 
 * Helper functions for wwsid and device_id generation, padding, etc.
 */

import { v5 as uuidv5 } from 'uuid';
import * as os from 'os';

/**
 * UUIDv5 namespaces as defined in spec
 */
export const WW_SESSION_NAMESPACE = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
export const WW_DEVICE_NAMESPACE = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

/**
 * Generate deterministic wwsid (wildwest session ID)
 * 
 * Same (tool, tool_sid) always produces the same wwsid.
 * Idempotent across runs and devices.
 * 
 * @param tool Tool code ('cpt', 'cld', 'ccx')
 * @param tool_sid Tool-native session ID
 * @returns UUIDv5 string
 */
export function generateWwsid(tool: string, tool_sid: string): string {
  const input = `${tool}:${tool_sid}`;
  return uuidv5(input, WW_SESSION_NAMESPACE);
}

/**
 * Generate deterministic device_id
 * 
 * Uses system hostname as the basis. Assumes single user per device.
 * In multi-user environments, could be extended to include username.
 * 
 * @returns UUIDv5 string
 */
export function generateDeviceId(): string {
  const hostname = os.hostname();
  return uuidv5(hostname, WW_DEVICE_NAMESPACE);
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
 * Format: <wwsid>-<seq_from_padded>-<seq_to_padded>.json
 * 
 * @param wwsid Wildwest session ID
 * @param seq_from First turn index in packet
 * @param seq_to Last turn index in packet
 * @returns Filename (no path)
 */
export function generatePacketFilename(wwsid: string, seq_from: number, seq_to: number): string {
  return `${wwsid}-${padSequence(seq_from)}-${padSequence(seq_to)}.json`;
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
