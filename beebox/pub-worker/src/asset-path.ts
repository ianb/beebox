/**
 * Serve-time path validation (Failure-modes finding — HIGH). R2 keys are FLAT,
 * so the only way an asset path could escape the `pubs/<id>/bundle/` prefix and
 * reach another pub's manifest (or, before the ingestion bucket split, the
 * `submissions/`/`access-log/` prefixes — now a different bucket entirely and so
 * out of PUB_STORE's key space by construction) is the Worker normalizing `..`
 * out of the prefix itself. Therefore this module NEVER normalizes: it rejects
 * any dangerous segment outright and returns 404 upstream.
 *
 * `URL` parsing already collapses a literal `/../` inside the path (so a plain
 * `..` segment never reaches here as a traversal), but percent-encoded forms
 * (`%2e%2e`, `..%2f`) survive URL parsing — those are exactly what this
 * validator catches, by decoding ONCE and refusing the decoded result.
 */

/** A `key`/`slug` URL segment (pub-id or slug) decoded and safety-checked. */
export function decodeSegment(raw: string): string | null {
  return checkDecoded(raw);
}

/**
 * Validate and decode the asset-path segments (everything after the key). Returns
 * the decoded segments joined with `/` (ready to append to the R2 key), or `null`
 * if any segment is dangerous. An empty segment (leading/double slash) is
 * rejected. A missing asset path (`[]`) resolves to `index.html`.
 */
export function resolveAssetPath(rawSegments: readonly string[]): string | null {
  if (rawSegments.length === 0) return "index.html";
  const decoded: string[] = [];
  for (const raw of rawSegments) {
    const seg = checkDecoded(raw);
    if (seg === null) return null;
    decoded.push(seg);
  }
  return decoded.join("/");
}

/**
 * Decode a single path segment once and reject it if, after decoding, it is a
 * traversal (`..`/`.`), carries a path separator (`/` or `\`), is empty, holds a
 * NUL, or begins with the reserved `__` prefix (which guards the Worker's own
 * `/__submit/` and account-route seams from bundle-path collision).
 */
function checkDecoded(raw: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch (_e) {
    // Malformed percent-encoding (e.g. an overlong/invalid UTF-8 sequence like
    // a `%c0%af` traversal) — refuse rather than guess.
    return null;
  }
  if (decoded.length === 0) return null;
  if (decoded === ".." || decoded === ".") return null;
  if (decoded.includes("/") || decoded.includes("\\")) return null;
  if (decoded.includes("\0")) return null;
  if (decoded.startsWith("__")) return null;
  return decoded;
}
