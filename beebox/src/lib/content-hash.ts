import { createHash } from "node:crypto";

/**
 * Short content fingerprint: the first 16 hex chars of the SHA-256 of `content`.
 * Shared by the Drive/Calendar connectors (change detection) and the search
 * store (index freshness), which previously kept identical private copies under
 * the names `contentHash` / `hashContent`.
 */
export function contentHash(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}
