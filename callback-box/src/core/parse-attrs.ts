/**
 * Parse `name="value"` attribute pairs out of a tag's attribute string into a
 * record. Shared by the chat-schedule tag parser (backend) and the chat tag
 * renderer (frontend), which kept equivalent private copies. Values are taken
 * verbatim (no entity decoding); a later duplicate key wins.
 *
 * The `Array`-returning parser in `core/chat/features` and the `Map`-returning
 * one in `frontend/lib/structured-output-parsing` are intentionally distinct —
 * their callers depend on those shapes — and are not folded in here.
 */
export function parseAttrs(s: string): Record<string, string> {
  if (!s || !s.trim()) return {};
  const attrs: Record<string, string> = {};
  for (const match of s.trim().matchAll(/([^\s=]+)="([^"]*)"/g)) {
    attrs[match[1]!.trim()] = match[2]!;
  }
  return attrs;
}
