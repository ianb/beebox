/**
 * The walk: from a live document (or any {@link ScanElement} tree) to the typed
 * list of controls currently on screen.
 *
 * Identity is authored and stable; name and description are read live and are
 * meant to change. A control is *addressable* only when it carries a
 * `cb-`-prefixed DOM id — everything else visible is still listed, with its
 * role, name and container and a null id, so the agent can describe it in words
 * without being handed a link the app cannot honour.
 *
 * The walk is over {@link ScanElement} rather than `Element` so it can be
 * exercised without a DOM (the frontend doctests run under plain Node);
 * `live-dom.ts` adapts the real document to it.
 */

import { computeAccessibleName } from "./accessible-name.js";
import { classifyElement } from "./roles.js";
import { CONTROL_ID_PREFIX, isControlAddress } from "./resolve.js";
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
 * Hidden for everything inside it, not just itself: these are the conditions the
 * walk stops descending on. A zero-sized box is deliberately not one of them — a
 * wrapper can measure zero and still contain a positioned, visible child.
 */
function hidesSubtree(element: ScanElement): boolean {
  if (attr(element, "aria-hidden") === "true") return true;
  if (attr(element, "hidden") !== null) return true;
  if (attr(element, "inert") !== null) return true;
  const style = element.style();
  if (style.display === "none") return true;
  if (style.visibility === "hidden") return true;
  return Number(style.opacity) === 0;
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
  return attr(element, "data-cb-reveal") === null ? base : [...base, "reveal"];
}

function addressOf(element: ScanElement): string | null {
  const id = attr(element, "id");
  if (id === null) return null;
  return isControlAddress(id) ? id : null;
}

/** Every `cb-` id carried by more than one element, hidden subtrees included. */
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
  let truncated = false;

  function visit(element: ScanElement, container: string | null): void {
    if (truncated) return;
    if (hidesSubtree(element)) return;

    let childContainer = container;
    const classified = classifyElement(element);
    if (classified !== null) {
      const rect = element.rect();
      // A connected element that measures zero is not on screen in any sense the
      // user would recognise, so it is neither listed nor counted as unnamed.
      if (rect.width > 0 && rect.height > 0) {
        const name = computeAccessibleName(element, { byId });
        if (name === "") {
          // A landmark tag that only becomes one when named (a bare `<section>`)
          // is not a missing label — it is just a box.
          if (!classified.nameRequired) omittedUnnamed += 1;
        } else if (entries.length >= MAX_ENTRIES) {
          truncated = true;
          return;
        } else {
          entries.push({
            id: addressOf(element),
            role: classified.role,
            name,
            container,
            does: nonEmpty(attr(element, "data-cb-does")),
            actions: actionsFor(element),
            disabled: isDisabled(element),
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
  return { entries, omittedUnnamed, duplicateIds: findDuplicateIds(root), truncated };
}
