/**
 * Resolving paths against a box's root URL. `boxUrl` already carries the box's
 * path prefix (origin + base + slug), so a page path is appended as a sibling
 * segment — mirroring how clerk-api builds `${boxUrl}/api/trpc/clerk.…`.
 */

/** Joins a box root URL and a relative page path, tolerating stray slashes. */
export function boxPageUrl(boxUrl: string, path: string): string {
  return `${boxUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

/**
 * The box's chat page with no session named — the box resolves that to its
 * most-active session (see ChatPage's bootstrap), which is what "go to this
 * box" should land on.
 */
export function boxChatUrl(boxUrl: string): string {
  return boxPageUrl(boxUrl, "chat");
}
