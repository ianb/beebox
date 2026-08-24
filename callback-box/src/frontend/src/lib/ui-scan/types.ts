/**
 * The control model: what the agent is told about one thing on the user's
 * screen, and the structural view of the document the scan walks to find it.
 *
 * Two shapes live here for one reason each:
 *
 * - {@link ControlEntry} / {@link ScanResult} are the payload. `ScanResult`
 *   carries the header facts the dump must state out loud — how many controls
 *   were dropped for having no name, which `cb-` addresses are duplicated, and
 *   whether the entry cap truncated the list — because a short list presented
 *   as a complete one is the failure this feature exists to avoid.
 * - {@link ScanElement} is a *minimal structural view* of a DOM element: the
 *   handful of things the walk actually reads. The real DOM is adapted to it in
 *   `live-dom.ts`; tests build it from an HTML fixture. It exists because the
 *   frontend doctests run under plain Node with no jsdom (see
 *   `lib/deferred-resync.ts` for the same seam applied to `document.hidden`),
 *   so a walk written against `Element` directly would be untestable here.
 */

/** What a `control:` pointer may ask the app to do with an element. */
export type ControlAction = "point" | "focus" | "reveal";

/** One control or landmark the scan found on screen. */
export interface ControlEntry {
  /**
   * Whether this entry is an operable control or the landmark that groups
   * them. Carried rather than inferred: the dump groups by it, and inferring
   * "this is a heading" from a name matching some other entry's container
   * silently demotes a real control that happens to share the name.
   */
  kind: "control" | "landmark";
  /**
   * The element's `cb-`-prefixed DOM id. Null for a control that is on screen
   * but was never given one — such a control appears in the dump so the agent
   * knows it exists, but cannot be pointed at.
   */
  id: string | null;
  /** ARIA role, explicit or implicit from the tag. */
  role: string;
  /** Computed accessible name. Never empty — a nameless control is dropped. */
  name: string;
  /** Nearest named region/landmark, for grouping in the dump. */
  container: string | null;
  /** Author-written "what it does", from `data-cb-does`. Read live, so it may
   *  legitimately differ between scans as the control changes state. */
  does: string | null;
  /** Actions this control opts into, from `data-cb-reveal`. */
  actions: ControlAction[];
  /** Present and false for a control that is visible but not operable. */
  disabled: boolean;
  /**
   * Mounted and laid out, but outside the viewport — scrolled out of a list, or
   * below the fold. Included deliberately (that is what `point` scrolls to) and
   * marked so the dump can say "not currently in view" rather than implying the
   * user is looking at it.
   */
  offscreen: boolean;
}

/** One scan: the entries plus the facts the dump header has to report. */
export interface ScanResult {
  /** Controls and landmarks, in document order. */
  entries: ControlEntry[];
  /** Visible controls dropped because they yielded no accessible name. */
  omittedUnnamed: number;
  /**
   * Visible elements dropped because they carry an explicit `role` the scan
   * does not report (`dialog`, `list`, an author's typo). Counted rather than
   * ignored so the dump can say *something* was left out — the same principle
   * as {@link ScanResult.omittedUnnamed}. `presentation`/`none` are excluded:
   * those say "this is not a control", which is an author's decision, not an
   * omission.
   */
  omittedUnknownRole: number;
  /**
   * `cb-` ids carried by more than one element anywhere in the document —
   * including inside hidden subtrees, since a mounted-but-CSS-hidden duplicate
   * breaks `getElementById` just as thoroughly as a visible one.
   */
  duplicateIds: string[];
  /** True when the entry cap stopped the walk before the document ended. */
  truncated: boolean;
}

/** The subset of a computed style the visibility rules read. */
export interface ScanStyle {
  display: string;
  visibility: string;
  opacity: string;
}

/** A border box in viewport coordinates, as `getBoundingClientRect` gives it. */
export interface ScanRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

/** A text node — the only non-element node the name computation cares about. */
export interface ScanTextNode {
  kind: "text";
  text: string;
}

/** The minimal element surface the scan and the name computation read. */
export interface ScanElement {
  kind: "element";
  /** Lowercase tag name (`button`, not `BUTTON`). */
  tag: string;
  /** Attributes by lowercase name. Absent is `undefined`, never `null`. */
  attributes: Readonly<Record<string, string>>;
  /** Child nodes in document order. */
  children: readonly ScanNode[];
  /** This element's own computed style — called lazily, once per walked element. */
  style: () => ScanStyle;
  /** This element's border box — called only for elements that reach an entry. */
  rect: () => ScanRect;
}

export type ScanNode = ScanElement | ScanTextNode;
