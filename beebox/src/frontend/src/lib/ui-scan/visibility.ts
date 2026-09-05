/**
 * The one definition of "on screen" this feature has.
 *
 * The walk (`scan.ts`) and the resolver (`resolve.ts` via `ControlPointer`)
 * both need it, and they must agree: a control the scan refuses to list is a
 * control a pointer must refuse to ring. Two implementations would drift into
 * pointing at a `display:none` desktop button while the dump — correctly —
 * never mentioned it.
 *
 * The walk descends the tree, so it applies {@link hidesSubtree} once per
 * element on the way down and never looks up. Resolution arrives at one element
 * with no path behind it, so it walks the ancestor chain itself
 * ({@link isNodeVisible}). Same predicate, two directions.
 *
 * Written against structural views rather than `Element` for the same reason
 * the rest of the directory is: the frontend doctests run under plain Node with
 * no jsdom. `live-dom.ts` adapts the real document.
 */

import type { ScanRect, ScanStyle } from "./types.js";

/** The part of an element the visibility rules read: attributes and style. */
export interface VisibilityFacts {
  /** Attributes by lowercase name. Absent is `undefined`, never `null`. */
  attributes: Readonly<Record<string, string>>;
  style: () => ScanStyle;
}

/**
 * One element plus the way up. `parent()` is a function, not a field, so the
 * live adapter never materialises a chain it is not asked for.
 */
export interface VisibilityNode extends VisibilityFacts {
  rect: () => ScanRect;
  parent: () => VisibilityNode | null;
}

/**
 * Hidden for everything inside it, not just itself: these are the conditions the
 * walk stops descending on. A zero-sized box is deliberately not one of them — a
 * wrapper can measure zero and still contain a positioned, visible child.
 */
export function hidesSubtree(element: VisibilityFacts): boolean {
  const attributes = element.attributes;
  if (attributes["aria-hidden"] === "true") return true;
  if (attributes["hidden"] !== undefined) return true;
  if (attributes["inert"] !== undefined) return true;
  const style = element.style();
  if (style.display === "none") return true;
  if (style.visibility === "hidden") return true;
  return Number(style.opacity) === 0;
}

/**
 * Whether this element is on screen: it has a non-zero box, and neither it nor
 * any ancestor hides its subtree.
 *
 * "On screen" here does not mean "in the viewport" — an element scrolled out of
 * view is visible in this sense, which is exactly what `point` scrolls to. It
 * also does not account for clipping by an `overflow: hidden` ancestor; see the
 * note on `offscreen` in `scan.ts`.
 */
export function isNodeVisible(node: VisibilityNode): boolean {
  const box = node.rect();
  if (box.width <= 0 || box.height <= 0) return false;
  for (let current: VisibilityNode | null = node; current !== null; current = current.parent()) {
    if (hidesSubtree(current)) return false;
  }
  return true;
}
