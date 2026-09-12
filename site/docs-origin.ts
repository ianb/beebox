// Absolute-URL origin for the agent-docs corpus. A chat agent fetching
// llms.txt does not reliably resolve relative or page-relative links, so
// every link the corpus emits is `origin + base + published path`. This is
// the one place that origin comes from.

/**
 * The canonical host once the Cloudflare Pages build goes live at base "/".
 * See issues/docs-and-chores/2026-07-21-pages-site-go-live.md.
 */
export const CANONICAL_ORIGIN = "https://beebox.run";

/** Origin for every other base (the dev router's `/<worktree>/site/`, `/main/site/`). */
const DEV_ORIGIN = "http://localhost:3210";

/**
 * The origin to prefix onto every link the agent-docs corpus emits. `base ===
 * "/"` is the canonical Cloudflare build; anything else resolves through the
 * local dev router.
 */
export function docsOrigin(base: string): string {
  return base === "/" ? CANONICAL_ORIGIN : DEV_ORIGIN;
}
