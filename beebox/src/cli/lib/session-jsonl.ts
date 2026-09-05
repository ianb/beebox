/**
 * Raw-line helpers for reading a Claude Code transcript JSONL.
 *
 * Split out of `session.ts` so the scanners there and the first-user-message
 * reader in `session-snippet.ts` share one definition without importing each
 * other (a value cycle).
 */

import { isRecord } from "../../lib/is-record.js";

/**
 * Parse one JSONL line, returning null for blank lines and unparseable lines
 * (a partial/concurrent write shouldn't abort the whole scan). `where`
 * identifies the caller in the debug log when a line is dropped.
 */
export function parseJsonlLine(line: string, where: string): Record<string, unknown> | null {
  if (!line.trim()) return null;
  try {
    const parsed: unknown = JSON.parse(line);
    return isRecord(parsed) ? parsed : null;
  } catch (e) {
    console.debug(`${where}: skipping unparseable JSONL line:`, e);
    return null;
  }
}

/** Normalize a raw `message.content` field into an array of block records. */
export function contentBlocks(content: unknown): Array<Record<string, unknown>> {
  if (typeof content === "string") return [{ type: "text", text: content }];
  if (Array.isArray(content)) return content.filter(isRecord);
  return [];
}
