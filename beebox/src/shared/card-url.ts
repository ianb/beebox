/**
 * App URL that opens a card where the person is — beside the chat:
 * `/<boxSlug>/views/<card path>`. Ordinary navigation (notifications, chips,
 * list rows) uses this; the Browse view is a maintenance surface.
 * `cardPath` is used as given: pass segment-encoded paths for an `href`
 * attribute or an absolute URL, raw paths for a router `to`.
 */
export function cardUrl(boxSlug: string, cardPath: string): string {
  return `/${boxSlug}/views/${cardPath.replace(/^\//, "")}`;
}
