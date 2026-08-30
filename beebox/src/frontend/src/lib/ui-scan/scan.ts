/**
 * The walk: from a live document (or any {@link ScanElement} tree) to the typed
 * list of controls currently on screen.
 *
 * Identity is authored and stable; name and description are read live and are
 * meant to change. A control is *addressable* only when it carries a
 * `bbx-`-prefixed DOM id — everything else visible is still listed, with its
 * role, name and container and a null id, so the agent can describe it in words
 * without being handed a link the app cannot honour.
 *
 * The walk covers chrome, not content: a subtree marked
 * `data-bbx-scan="exclude"` ({@link SCAN_BOUNDARY_ATTRIBUTE}) is pruned the way
 * an `aria-hidden` one is, which is what keeps the transcript, the open card and
 * the embeds out of a payload the agent is told is an inventory of controls.
 *
 * The walk is over {@link ScanElement} rather than `Element` so it can be
 * exercised without a DOM (the frontend doctests run under plain Node);
 * `live-dom.ts` adapts the real document to it. Visibility itself lives in
 * `visibility.ts`, shared with the resolver so the two cannot disagree.
 */

import { computeAccessibleName } from "./accessible-name.js";
import { classifyElement } from "./roles.js";
import { CONTROL_ID_PREFIX, isControlAddress } from "./resolve.js";
import { hidesSubtree } from "./visibility.js";
import type { ControlAction, ControlEntry, ScanElement, ScanResult } from "./types.js";

/**
 * Hard cap on reported entries. A page with more chrome than this produces a
 * truncated list, and the dump says so — the alternative is a payload that
 * quietly costs more context than the answer is worth.
 */
export const MAX_ENTRIES = 200;

export interface ScanOptions {
  /** Viewport size in CSS pixels, for deciding {@link ControlEntry.offscreen}. */
  viewport: { width: number; height: number };
}

function attr(element: ScanElement, name: string): string | null {
  const value = element.attributes[name];
  return value === undefined ? null : value;
}

/**
 * The value of {@link SCAN_BOUNDARY_ATTRIBUTE} that prunes a subtree: everything
 * inside is user content, not chrome. Spelled as a value rather than a bare
 * attribute so the attribute has room to grow another one later.
 */
const SCAN_EXCLUDE = "exclude";

/**
 * Marks a subtree as user content, pruning it from the walk exactly the way
 * `aria-hidden` does — the elements inside are still on the user's screen, they
 * are simply not this payload's business.
 *
 * It is what makes "the dump is chrome" true rather than aspirational: without
 * it the walk reaches every link, button and textbox the user's own cards,
 * transcript and embeds render, and ships their accessible names to the agent.
 * That is the content the scan is *not* the way to learn about (the agent reads
 * a card by opening it), and it is why the request needs no consent prompt
 * (`components/chat/ui-scan-request-handler.ts`).
 *
 * It goes on content roots only, never on the chrome around them: the companion
 * pane's tab strip and close button stay scannable while the card rendered
 * below them does not. No `bbx-` address sits inside an excluded subtree.
 *
 * Excluded controls are not counted. An omission the dump reports is one the
 * agent might otherwise be misled by; this is a boundary the design drew, and
 * "42 controls you may not see" would invite exactly the guessing the boundary
 * exists to prevent. Duplicate-address detection still covers the whole
 * document — a duplicate `bbx-` id anywhere breaks `getElementById`.
 */
const SCAN_BOUNDARY_ATTRIBUTE = "data-bbx-scan";

/** Whether this element roots a user-content region the scan must not enter. */
function isContentBoundary(element: ScanElement): boolean {
  return attr(element, SCAN_BOUNDARY_ATTRIBUTE) === SCAN_EXCLUDE;
}

/** An attribute present but blank says nothing, so it reads as absent. */
function nonEmpty(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function isDisabled(element: ScanElement): boolean {
  if (attr(element, "disabled") !== null) return true;
  return attr(element, "aria-disabled") === "true";
}

function actionsFor(element: ScanElement): ControlAction[] {
  const base: ControlAction[] = ["point", "focus"];
  // `reveal` is the only action that dispatches a synthetic click, so it is an
  // explicit author opt-in — never inferred from `aria-expanded`/`role="tab"`,
  // which describe interaction semantics and do not classify an action as safe.
  return attr(element, "data-bbx-reveal") === null ? base : [...base, "reveal"];
}

function addressOf(element: ScanElement): string | null {
  const id = attr(element, "id");
  if (id === null) return null;
  return isControlAddress(id) ? id : null;
}

/** Every `bbx-` id carried by more than one element, hidden subtrees included. */
function findDuplicateIds(root: ScanElement): string[] {
  const counts = new Map<string, number>();
  function count(element: ScanElement): void {
    const id = attr(element, "id");
    if (id !== null && id.startsWith(CONTROL_ID_PREFIX)) {
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    for (const child of element.children) if (child.kind === "element") count(child);
  }
  count(root);
  return [...counts.entries()].filter(([, n]) => n > 1).map(([id]) => id);
}

/** Every id in the tree, for `aria-labelledby` resolution. First occurrence wins. */
function indexIds(root: ScanElement): Map<string, ScanElement> {
  const index = new Map<string, ScanElement>();
  function add(element: ScanElement): void {
    const id = attr(element, "id");
    if (id !== null && !index.has(id)) index.set(id, element);
    for (const child of element.children) if (child.kind === "element") add(child);
  }
  add(root);
  return index;
}

/**
 * Walk `root` and report the controls and landmarks on screen.
 *
 * Off-screen-but-mounted elements are included and marked: a control scrolled
 * out of view is exactly what `point` exists to scroll to.
 */
export function scanControls(root: ScanElement, options: ScanOptions): ScanResult {
  const index = indexIds(root);
  const byId = (id: string): ScanElement | null => index.get(id) ?? null;
  const entries: ControlEntry[] = [];
  let omittedUnnamed = 0;
  let omittedUnknownRole = 0;
  let truncated = false;

  function visit(element: ScanElement, container: string | null): void {
    if (truncated) return;
    if (isContentBoundary(element)) return;
    if (hidesSubtree(element)) return;

    let childContainer = container;
    const classified = classifyElement(element);
    if (classified === null) {
      // An explicit role the scan does not report is an omission worth a number
      // (an author's typo looks exactly like a role we chose not to list).
      // `presentation`/`none` are the author saying "not a control" — not an
      // omission. The `rect()` call is confined to this narrow case.
      const explicitRole = attr(element, "role");
      if (explicitRole !== null && explicitRole !== "presentation" && explicitRole !== "none") {
        const rect = element.rect();
        if (rect.width > 0 && rect.height > 0) omittedUnknownRole += 1;
      }
    } else {
      const rect = element.rect();
      // A connected element that measures zero is not on screen in any sense the
      // user would recognise, so it is neither listed nor counted as unnamed.
      if (rect.width > 0 && rect.height > 0) {
        // A landmark is never named by its contents (see `accessible-name.ts`):
        // `<main>` would otherwise report the whole transcript as its name.
        const name = computeAccessibleName(element, { byId, fromContent: classified.kind === "control" });
        if (name === "") {
          // A landmark tag that only becomes one when named (a bare `<section>`)
          // is not a missing label — it is just a box.
          if (!classified.nameRequired) omittedUnnamed += 1;
        } else if (entries.length >= MAX_ENTRIES) {
          truncated = true;
          return;
        } else {
          entries.push({
            kind: classified.kind,
            id: addressOf(element),
            role: classified.role,
            name,
            container,
            does: nonEmpty(attr(element, "data-bbx-does")),
            actions: actionsFor(element),
            disabled: isDisabled(element),
            // Viewport-relative only. An element scrolled out of an
            // `overflow: hidden` ancestor while its own box still lands inside
            // the viewport reports `offscreen: false` — the ring's `point`
            // scrolls it into view regardless, so the cost is a dump that
            // undersells how hidden a control is, never a pointer that lands
            // nowhere. Testing every clipping ancestor would mean reading each
            // one's overflow and box on the way down, which the lazy `style()`
            // /`rect()` seam exists to avoid; the limitation is documented
            // instead (docs/plans/agent-points-at-ui.md, "Visibility").
            offscreen:
              rect.left + rect.width <= 0 ||
              rect.top + rect.height <= 0 ||
              rect.left >= options.viewport.width ||
              rect.top >= options.viewport.height,
          });
          if (classified.kind === "landmark") childContainer = name;
        }
      }
    }

    for (const child of element.children) {
      if (child.kind === "element") visit(child, childContainer);
    }
  }

  visit(root, null);
  return {
    entries,
    omittedUnnamed,
    omittedUnknownRole,
    duplicateIds: findDuplicateIds(root),
    truncated,
  };
}
