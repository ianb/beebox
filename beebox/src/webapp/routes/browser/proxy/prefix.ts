/**
 * The external path prefix of the box browser page, for rewriting the
 * dashboard's root-absolute paths (docs/plans/shared-browser.md, Track C).
 *
 * The box's own part, `/<slug>/browser`, is in the request path: the hub
 * forwards box paths unchanged. A dev router in front of the hub adds an outer
 * segment (`/<worktree>`) that the box never sees: Vite strips it, and the hub
 * replaces the router's `x-bbx-base-prefix` with its own `/<slug>`, which
 * would double the slug if added to the path. So Vite's proxy rule for the
 * browser path sends the segment it strips as `X-Forwarded-Prefix`
 * (`src/frontend/vite.config.ts`). In production nothing sits in front of the
 * hub's paths and the header is absent.
 *
 * The Referer cannot carry it: a typed or reloaded URL sends none, and the
 * page came back unstyled (G2, 2026-10-30). Relative paths in the page cannot
 * either: the dashboard's script loader matches its chunks by absolute path
 * and never starts.
 *
 * A client can send the header itself. The value only shapes paths in the
 * response to that same client, and it is validated as plain path segments
 * so it cannot leave the origin.
 */

const OUTER_PREFIX_RE = /^(?:\/[\w.-]+)+$/;

export interface BrowserPrefixInput {
  readonly slug: string;
  /** The `X-Forwarded-Prefix` request header. */
  readonly forwardedPrefix: string | string[] | undefined;
}

/** The outer prefix in front of `/<slug>/`, or "". */
function outerPrefix(forwardedPrefix: BrowserPrefixInput["forwardedPrefix"]): string {
  const value = Array.isArray(forwardedPrefix) ? forwardedPrefix[0] : forwardedPrefix;
  if (value === undefined || value.includes("..") || !OUTER_PREFIX_RE.test(value)) return "";
  return value;
}

/** `<outer>/<slug>/browser`: the prefix the dashboard's paths are rewritten under. */
export function browserPrefix(input: BrowserPrefixInput): string {
  return `${outerPrefix(input.forwardedPrefix)}/${input.slug}/browser`;
}
