/**
 * Regex construction for AX-snapshot matching. Locator names come from tour
 * scripts at runtime, so these patterns can't be regex literals: every dynamic
 * part is escaped with escapeForRegex, the input is trusted (tour authors in
 * this repo), and the target is a local snapshot string — no injection or
 * ReDoS surface. Centralizing the construction keeps the one justified lint
 * exception in a single place instead of at every call site.
 */

export function escapeForRegex(s: string): string {
  return s.replace(/[$()*+.?[\\\]^{|}]/g, "\\$&");
}

export function snapshotRegex(source: string, flags?: string): RegExp {
  // eslint-disable-next-line security/detect-non-literal-regexp -- see module doc: escaped, trusted tour-script input matched against local snapshot strings
  return new RegExp(source, flags);
}
