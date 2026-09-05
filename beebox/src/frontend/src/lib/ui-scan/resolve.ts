/**
 * The other direction: from a `control:` address back to a live element.
 *
 * The address *is* an HTML `id`, so resolution is one `getElementById` call —
 * browser-guaranteed, with no selector escaping (hence kebab-case and not dots:
 * `querySelector("#a.b")` parses as id `a` plus class `b`).
 *
 * Fails closed, like `resolveRefPath` (`src/shared/ref-path.ts`): an id that is
 * not a well-formed `bbx-` address is rejected without touching the document, and
 * a well-formed one that matches nothing is a named failure the caller renders
 * as broken. A *duplicate* cannot be detected here — `getElementById` returns
 * the first in document order — which is why uniqueness is enforced upstream by
 * axe in the tours, with the scan reporting duplicates as a second line.
 *
 * Existing is not enough to act on, so {@link resolveVisibleControl} is what
 * the app calls: an id can match an element that is mounted and CSS-hidden (the
 * responsive composer rows are both mounted at every width), and pointing at
 * one would ring a box the user cannot see.
 */

// Raw relative (not `@shared/…`): loaded outside Vite by its own doctest, which
// runs under the root tsconfig where the alias does not resolve.
import { err, ok, type Result } from "../../../../shared/result.js";

/** The namespace that separates published addresses from internal a11y wiring. */
export const CONTROL_ID_PREFIX = "bbx-";

/** `bbx-` plus kebab-case segments — nothing that would need escaping. */
const CONTROL_ID_PATTERN = /^bbx(?:-[\da-z]+)+$/;

/** Whether an id is a control address at all, before any lookup. */
export function isControlAddress(id: string): boolean {
  return CONTROL_ID_PATTERN.test(id);
}

/**
 * Why an address did not resolve. Callers branch on this to write the tooltip.
 *
 * `hidden` is a *found* element that is not on screen — the mounted-but-CSS-
 * hidden half of a responsive pair is the everyday case: both composer rows are
 * mounted at every width, so at a desktop width `bbx-composer-send-mobile` is
 * present in the document and `display:none`. Ringing it would draw a ring
 * around nothing, and `reveal` would synthetically click a control the user
 * cannot see. It is a distinct failure from `not-found` because it reads
 * differently: the control exists, just not on this screen right now.
 */
export type ResolveFailure = "bad-id" | "not-found" | "hidden";

/** The document surface `resolveControl` needs — the real `Document` satisfies it. */
export interface ElementLookup<E> {
  getElementById: (id: string) => E | null;
}

/**
 * The element this address names, or why it does not name one.
 *
 * Generic in the element type so the live `document` resolves to `HTMLElement`
 * while a test resolves to a fixture, with no cast at either call site.
 */
export function resolveControl<E>(id: string, lookup: ElementLookup<E>): Result<E, ResolveFailure> {
  if (!isControlAddress(id)) return err("bad-id");
  const element = lookup.getElementById(id);
  return element === null ? err("not-found") : ok(element);
}

/**
 * A document plus the question "can the user see this element right now" —
 * everything {@link resolveVisibleControl} needs.
 *
 * `isVisible` is supplied by the caller rather than imported so this module
 * stays free of the DOM (and of `ScanElement`): `ControlPointer` passes the
 * live-element predicate from `live-dom.ts`, a doctest passes a fixture one.
 * Both end up at the same `visibility.ts` rules the scan walks with, which is
 * the point — a control the dump never listed must not be one a pointer rings.
 */
export interface VisibleElementLookup<E> extends ElementLookup<E> {
  isVisible: (element: E) => boolean;
}

/**
 * The element this address names *and* that the user can currently see.
 *
 * The order of failures is the order of certainty: a malformed address never
 * touches the document, a missing one never gets measured.
 */
export function resolveVisibleControl<E>(
  id: string,
  source: VisibleElementLookup<E>
): Result<E, ResolveFailure> {
  const resolved = resolveControl(id, source);
  if (!resolved.ok) return resolved;
  return source.isVisible(resolved.value) ? resolved : err("hidden");
}
