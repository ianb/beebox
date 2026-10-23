import { createHash } from "node:crypto";

/**
 * Short content fingerprint: the first 16 hex chars of the SHA-256 of `content`.
 * Shared by the Drive/Calendar connectors (change detection) and the search
 * store (index freshness), which previously kept identical private copies under
 * the names `contentHash` / `hashContent`.
 */
export function contentHash(content: string): string {
  return sha256Hex(content).slice(0, 16);
}

/** The full SHA-256 of `content` as 64 lowercase hex chars (a string is hashed as UTF-8). */
export function sha256Hex(content: string | Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
}
