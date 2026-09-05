/**
 * What a `control:` pointer does once its address has resolved to an element.
 *
 * The dispatch is written against {@link ControlTarget} — the four things an
 * action needs from an element — rather than `HTMLElement`, for the same reason
 * the scan walks `ScanElement`: the frontend doctests run under plain Node with
 * no jsdom, and a dispatch written against the DOM would be untestable here.
 * `ControlPointer` supplies the live-element implementation.
 *
 * The reveal/do boundary lives here and nowhere else: `reveal` clicks the target
 * only when the author opted in with `data-bbx-reveal`. A control without it is
 * never clicked, whatever its markup says — the pointer degrades to `point` and
 * the caller says why, rather than acting for the user on an inference.
 */

import type { ControlAction } from "./types.js";

/** The element surface an action reads and drives. */
export interface ControlTarget {
  /** Whether the element carries `data-bbx-reveal` — the author's opt-in. */
  revealable: boolean;
  /** Whether the element's box is fully inside the viewport already. */
  inView: boolean;
  scrollIntoView: () => void;
  focus: () => void;
  click: () => void;
}

/** What actually happened, so the caller can report a degraded action. */
export interface ActionOutcome {
  scrolled: boolean;
  focused: boolean;
  revealed: boolean;
  /**
   * Why the requested action was not carried out in full; null when it was.
   * Shown in the pointer's tooltip — a degraded action is visible, not silent.
   */
  degraded: string | null;
}

/** The one reason a `reveal` degrades: the author never opted the control in. */
export const REVEAL_NOT_OPTED_IN =
  "this control is not marked as a disclosure control, so it was pointed at rather than opened";

/**
 * Run `action` against `target`. Every action points first — scrolling only when
 * the element is not already fully in view — so the ring the caller draws always
 * lands on something the user can see.
 */
export function performControlAction(action: ControlAction, target: ControlTarget): ActionOutcome {
  const scrolled = !target.inView;
  if (scrolled) target.scrollIntoView();
  switch (action) {
    case "point":
      return { scrolled, focused: false, revealed: false, degraded: null };
    case "focus":
      target.focus();
      return { scrolled, focused: true, revealed: false, degraded: null };
    case "reveal":
      if (!target.revealable) {
        return { scrolled, focused: false, revealed: false, degraded: REVEAL_NOT_OPTED_IN };
      }
      target.click();
      return { scrolled, focused: false, revealed: true, degraded: null };
  }
}
