/**
 * Rewrites the upstream agent-browser dashboard so it works under a path
 * prefix (docs/plans/shared-browser.md, Track C).
 *
 * The dashboard is a static Next.js export that assumes it is served at the
 * root: its HTML, CSS and scripts name `/_next/...` assets and `/api/...`
 * endpoints as root-absolute paths. The box serves it at
 * `<base>/<slug>/browser/`, so every such path needs the prefix. The pattern
 * matches a root-absolute `/_next/` or `/api/` that follows a quote, a
 * backtick, an opening parenthesis (CSS `url(`) or an escaped quote (`\"`
 * inside a JSON string in the page).
 *
 * The rule depends on the bundle's exact shape, so agent-browser is pinned and
 * a contract test counts the sites in the real bundle; an upgrade that changes
 * the shape fails that test instead of breaking the page silently.
 */

const PATH_SITE = /(["'(`]|\\")\/(_next|api)\//g;
const REWRITABLE_TYPES = new Set(["text/html", "text/css", "application/javascript", "text/javascript"]);
const VALID_PREFIX = /^\/[\w./-]*[\w.-]$/;

export class InvalidRewritePrefixError extends Error {
  override name = "InvalidRewritePrefixError";
  constructor(readonly prefix: string) {
    super(`Invalid dashboard rewrite prefix ${JSON.stringify(prefix)}: it must start with "/", have no trailing "/", no "..", and use only letters, digits, "_", ".", "/" and "-"`);
  }
}

function assertValidPrefix(prefix: string): void {
  if (!VALID_PREFIX.test(prefix) || prefix.includes("..") || prefix.includes("//")) throw new InvalidRewritePrefixError(prefix);
}

/** Adds `prefix` to every root-absolute `/_next/` and `/api/` path in `body`. */
export function rewriteDashboardBody(body: string, prefix: string): string {
  assertValidPrefix(prefix);
  return body.replace(PATH_SITE, `$1${prefix}/$2/`);
}

/** True for the content types the rewrite applies to; parameters such as `charset` are ignored. */
export function isRewritableType(contentType: string | undefined): boolean {
  if (contentType === undefined) return false;
  const base = contentType.split(";")[0] ?? "";
  return REWRITABLE_TYPES.has(base.trim().toLowerCase());
}

/** How many root-absolute dashboard paths `body` holds. */
export function countDashboardPathSites(body: string): number {
  return [...body.matchAll(PATH_SITE)].length;
}
