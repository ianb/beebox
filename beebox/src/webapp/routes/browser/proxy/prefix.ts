/**
 * The external path prefix of the box browser page, for rewriting the
 * dashboard's root-absolute paths (docs/plans/shared-browser.md, Track C).
 *
 * The box's own part, `/<slug>/browser`, is in the request path: the hub
 * forwards box paths unchanged. A dev router in front of the hub adds an outer
 * segment (`/<worktree>`) that the box never sees: Vite strips it, and the hub
 * replaces the router's `x-bbx-base-prefix` with its own `/<slug>`, which
 * would double the slug if added to the path. So the outer segment comes from
 * the page the request came from: the browser sends a same-origin `Referer`
 * with the full path, both when the person opens the page from the app
 * (`/<worktree>/<slug>/chat`) and for every request the dashboard makes
 * (`/<worktree>/<slug>/browser/`). Whatever precedes `/<slug>/` there is the
 * outer prefix. With no usable `Referer` the outer prefix is empty, which is
 * right in production, where nothing sits in front of the hub's paths.
 *
 * The value only shapes paths in a response to the same person; it is
 * validated as plain path segments so it cannot leave the origin.
 */

const OUTER_PREFIX_RE = /^(?:\/[\w.-]+)+$/;

export interface BrowserPrefixInput {
  readonly slug: string;
  readonly referer: string | undefined;
}

/** The outer prefix the `Referer` shows in front of `/<slug>/`, or "". */
function outerPrefix({ slug, referer }: BrowserPrefixInput): string {
  if (referer === undefined) return "";
  let refPath: string;
  try {
    refPath = new URL(referer).pathname;
  } catch (_e) {
    return "";
  }
  const at = refPath.indexOf(`/${slug}/`);
  if (at <= 0) return "";
  const outer = refPath.slice(0, at);
  if (outer.includes("..") || !OUTER_PREFIX_RE.test(outer)) return "";
  return outer;
}

/** `<outer>/<slug>/browser`: the prefix the dashboard's paths are rewritten under. */
export function browserPrefix(input: BrowserPrefixInput): string {
  return `${outerPrefix(input)}/${input.slug}/browser`;
}
