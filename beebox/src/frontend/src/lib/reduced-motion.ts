/**
 * Whether this viewer asked the system to reduce motion.
 *
 * The predicate for imperative animation code — a scroll, a spring, an eased
 * write — which cannot express the preference in CSS. Declarative motion uses
 * Tailwind's `motion-safe:` prefix instead (see `components/ui/Dropdown.tsx`);
 * this is its scripted counterpart, in one place so the media query is not
 * spelled out three different times.
 */

export function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
