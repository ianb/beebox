// Which exhibit a raw page belongs to, read from its URL.
//
// The exhibits origin serves a page at /<workstream>/<exhibit>/ (or
// /apps/<name>/ for a committed app), so the scope the comment and focus
// routes take is the first two path segments. This is the one decision the
// controls mount makes; it is a pure function so a test reaches it.

/** `<workstream>/<exhibit>` from a page path, or null when the path has fewer than two segments. */
export function scopeFromPath(pathname: string): string | null {
  const [workstream, exhibit] = pathname.split("/").filter((segment) => segment !== "");
  if (workstream === undefined || exhibit === undefined) return null;
  return `${workstream}/${exhibit}`;
}

/** Store exhibits have a workstream to route a comment to; committed apps do not. */
export function isStoreScope(scope: string): boolean {
  return !scope.startsWith("apps/");
}
