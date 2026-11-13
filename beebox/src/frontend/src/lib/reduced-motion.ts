/**
 * Whether this viewer asked the system to reduce motion.
 *
 * The predicate for imperative animation code — a scroll, a spring, an eased
 * write — which cannot express the preference in CSS. Declarative motion needs
 * nothing per site: the global `prefers-reduced-motion` rule in `index.css`
 * shortens every CSS animation and transition. This is its scripted
 * counterpart, in one place so the media query is not spelled out three
 * different times.
 */

export function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
