/**
 * Resolve the box's public base URL from the environment, falling back to a
 * caller-supplied default. The two former copies differed only in that default
 * — the chat session pool passed `""` (and omits the session view URL when
 * empty), while auth passed `"http://localhost:3210"` (it needs a concrete
 * base to build an OAuth redirect URI) — so the default is a parameter here
 * rather than baked in.
 */
export function getPublicUrl(fallback: string): string {
  return process.env.CB_PUBLIC_URL || process.env.PUBLIC_URL || fallback;
}
