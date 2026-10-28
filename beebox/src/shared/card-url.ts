/**
 * App URL that opens a card where the person is — beside the chat:
 * `/<boxSlug>/views/<card path>`, each path segment encoded so a `#`, `?`, or
 * `%` in a filename stays part of it. Ordinary navigation (notifications,
 * chips, list rows) uses this; the Browse view is a maintenance surface.
 */
export function cardUrl(boxSlug: string, cardPath: string): string {
  return `/${boxSlug}${boxCardPath(cardPath)}`;
}

/** {@link cardUrl} without the box prefix: `/views/<encoded card path>`. */
export function boxCardPath(cardPath: string): string {
  return `/views/${cardPath.replace(/^\//, "").split("/").map((segment) => encodeURIComponent(segment)).join("/")}`;
}
