/**
 * Reading agent-browser accessibility snapshots: finding a ref, reading the
 * place menu, and deciding whether a page actually rendered.
 *
 * Pure — no fs, no network, no child processes (split out of bin/smoke-probe.ts
 * for size; same testing story, bin/smoke-snapshot.test.ts).
 *
 * See issues/exploration/2026-08-26-merge-time-smoke-tier.md.
 */

import {
  PlaceMenuCollapsedError,
  PlaceMenuErroredError,
  PlaceMenuMissingFixedRowsError,
  PlaceMenuNoLandmarksError,
  type SmokeFailureError,
} from "./smoke-errors.js";

/**
 * A `[ref=eN]` for a role + accessible name in an agent-browser snapshot.
 *
 * Duplicated intent with tour-lib's `findRef`, but not its implementation: this
 * one is given the snapshot text rather than fetching it, which is what makes
 * it testable and lets one snapshot answer several questions without a second
 * browser round-trip (the tier's whole time budget is round-trips).
 */
export function refFor(snapshot: string, target: { role: string; name: string }): string | null {
  // Plain string scanning rather than a RegExp built from the caller's strings:
  // a name carrying regex metacharacters would otherwise have to be escaped by
  // hand at every call, and the snapshot format is fixed enough not to need one.
  const marker = `${target.role} "${target.name}"`;
  for (const line of snapshot.split("\n")) {
    let from = 0;
    for (;;) {
      const at = line.indexOf(marker, from);
      if (at === -1) break;
      from = at + 1;
      const before = line.slice(at - 1, at);
      if (before !== "" && WORD_CHAR.test(before)) continue;
      const rest = line.slice(at + marker.length);
      const attrs = rest.trimStart();
      // `\s+\[` — the bracket must be separated from the name.
      if (attrs === rest || !attrs.startsWith("[")) continue;
      const close = attrs.indexOf("]");
      const inside = close === -1 ? attrs.slice(1) : attrs.slice(1, close);
      for (const part of inside.split(",")) {
        const ref = REF_ATTR.exec(part.trimStart())?.[1];
        if (ref !== undefined) return ref;
      }
    }
  }
  return null;
}

const WORD_CHAR = /\w/;
const REF_ATTR = /^ref=(e\d+)/;

/** Every `menuitem "…"` name in a snapshot, in document order. */
export function menuItemNames(snapshot: string): string[] {
  return [...snapshot.matchAll(/\bmenuitem\s+"([^"]*)"/g)].map((m) => m[1] ?? "");
}

/** Is the element carrying this DOM id expanded? Null when it is not present. */
export function expandedState(snapshot: string, domId: string): boolean | null {
  const line = snapshot
    .split("\n")
    .find((candidate) => candidate.includes(`id=${domId}`));
  if (line === undefined) return null;
  return /\bexpanded=true\b/.test(line);
}

/**
 * The place menu's fixed rows (bin-independent: they carry stable DOM ids in
 * PlacePill-panels.tsx). Landmark rows are everything else, and "at least one
 * landmark row" is the assertion that the menu's data actually resolved.
 */
const FIXED_MENU_IDS = [
  "cb-switch-menu-box",
  "cb-switch-menu-landmarks",
  "cb-switch-menu-recent-files",
];

/** The exact copy the menu shows when its landmark query failed (Retry row). */
export const MENU_ERROR_TEXT = "Couldn’t load this menu";

export interface PlaceMenuReading {
  expanded: boolean;
  fixedRowsPresent: boolean;
  landmarkNames: string[];
  errored: boolean;
}

export function readPlaceMenu(snapshot: string): PlaceMenuReading {
  const fixedNames = new Set(
    FIXED_MENU_IDS.map((id) => nameForId(snapshot, id)).filter(
      (name): name is string => name !== null,
    ),
  );
  return {
    expanded: expandedState(snapshot, "cb-nav-place") === true,
    fixedRowsPresent: fixedNames.size === FIXED_MENU_IDS.length,
    landmarkNames: menuItemNames(snapshot).filter((name) => !fixedNames.has(name)),
    // The apostrophe is a typographic one in the JSX and renders as such;
    // accept the ASCII spelling too rather than let a copy edit blind us.
    errored:
      snapshot.includes(MENU_ERROR_TEXT) || snapshot.includes("Couldn't load this menu"),
  };
}

function nameForId(snapshot: string, domId: string): string | null {
  const line = snapshot.split("\n").find((candidate) => candidate.includes(`id=${domId}`));
  if (line === undefined) return null;
  return /"([^"]*)"/.exec(line)?.[1] ?? null;
}

/** The failure the place-menu reading deserves; null when it passed. */
export function placeMenuFailure(reading: PlaceMenuReading, snapshot: string): SmokeFailureError | null {
  if (reading.errored) {
    return new PlaceMenuErroredError(snapshot);
  }
  if (!reading.expanded) {
    return new PlaceMenuCollapsedError(snapshot);
  }
  if (!reading.fixedRowsPresent) {
    return new PlaceMenuMissingFixedRowsError(snapshot);
  }
  if (reading.landmarkNames.length === 0) {
    return new PlaceMenuNoLandmarksError(snapshot);
  }
  return null;
}

/** Does the snapshot contain an element carrying this DOM id? */
export function hasDomId(snapshot: string, domId: string): boolean {
  return snapshot.includes(`id=${domId}`);
}

/**
 * Directory rows in the browse sidebar, which the box's real content produces
 * (`button "store directory, 46 items"`). Counting them is how this tier
 * checks that a card read reached the browser: an empty list is what a backend
 * that answered but returned nothing looks like.
 */
export function directoryRowCount(snapshot: string): number {
  return [...snapshot.matchAll(/\bbutton\s+"[^"]* directory(?:,[^"]*)?"/g)].length;
}

/**
 * Did the card detail pane actually render the card, or just its frame?
 *
 * The open-card link exists as soon as the pane mounts, so asserting on it
 * alone passes for a card whose body failed to load. A rendered card also
 * carries its own title as a heading.
 */
export function cardViewRendered(snapshot: string): boolean {
  return /\bheading\s+"[^"]+"\s+\[level=2/.test(snapshot);
}

/** The first card row in the browse sidebar, as a role + name pair to click. */
export function firstCardRow(snapshot: string): { role: "button"; name: string } | null {
  const match = /\bbutton\s+"([^"]* card)"\s+\[/.exec(snapshot);
  const name = match?.[1];
  return name === undefined ? null : { role: "button", name };
}
