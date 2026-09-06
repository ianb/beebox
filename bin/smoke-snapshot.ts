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
  PlaceSwitchDidNotNavigateError,
  PlaceSwitchDidNotTakeError,
  type SmokeFailureError,
} from "./smoke-errors.js";
import { LANDMARK_CONTENT_DIR } from "../beebox/src/core/landmark/root-dir.js";
import { areaDisplayLabel } from "../beebox/src/shared/display-path.js";

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
  "bbx-switch-menu-box",
  "bbx-switch-menu-landmarks",
  "bbx-switch-menu-recent-files",
];

/** The exact copy the menu shows when its landmark query failed (Retry row). */
export const MENU_ERROR_TEXT = "Couldn’t load this menu";

/** A bare `StaticText "…"` row, which is how a section header renders. */
const STATIC_TEXT_ROW = /^\s*-?\s*StaticText\s+"([^"]*)"\s*$/;

/**
 * The header the menu renders above its landmark list. It is uppercased by CSS
 * and the accessibility tree reflects that, so the comparison is case-folded.
 */
const SWITCH_SECTION_TEXT = "switch to";

function isSwitchSectionHeader(line: string): boolean {
  return STATIC_TEXT_ROW.exec(line)?.[1]?.toLowerCase() === SWITCH_SECTION_TEXT;
}

export interface LandmarkRow {
  /** The row's accessible name with the menu's own decorations removed. */
  label: string;
  /** As rendered, decorations included — what a ref lookup has to match. */
  rawName: string;
  /** The row the menu marks as where you already are. */
  current: boolean;
}

/**
 * Strip what the menu adds to a landmark's own label.
 *
 * The active row carries an sr-only `(current)`, and any row with unread items
 * carries a bare count that is not aria-hidden
 * (`PlacePill-panels.tsx`, `FreshCount`). Both land in the accessible name, so
 * a healthy row reads `Acids & Bases 2` or `Box (current)`. Comparing those
 * against the place pill's label — which carries neither — fails a working box.
 */
export function stripRowDecorations(name: string): string {
  // Rendered order is label, ✓ (aria-hidden), sr-only "(current)", count — so
  // the count is stripped first and the pair is looped until stable rather than
  // assuming which of the two a given row carries.
  let out = name.trim();
  for (;;) {
    const next = out.replace(/\s+\d+$/, "").replace(/\s*\(current\)$/i, "").trim();
    if (next === out) return out;
    out = next;
  }
}

export interface PlaceMenuReading {
  expanded: boolean;
  fixedRowsPresent: boolean;
  landmarks: LandmarkRow[];
  errored: boolean;
}

/**
 * Read the open menu, from a FULL accessibility snapshot.
 *
 * Not the interactive-only view: the only thing separating landmark rows from
 * the nav-card rows above them is a `StaticText` section header, which that
 * view drops. Given an interactive snapshot this returns no landmarks, which
 * `placeMenuFailure` reports as an empty menu — loudly wrong rather than
 * quietly permissive.
 *
 * Landmark rows are the menuitems BELOW the "Switch to" header, not "every
 * menuitem that is not one of the three fixed ids". A box with nav cards
 * renders those as plain menuitems above that header
 * (`PlacePill-panels.tsx`, `NavCardRows`), and counting them as landmarks
 * meant the walk could try to switch to a route.
 */
export function readPlaceMenu(snapshot: string): PlaceMenuReading {
  const lines = snapshot.split("\n");
  const start = lines.findIndex((line) => isSwitchSectionHeader(line));
  const landmarks: LandmarkRow[] = [];
  if (start !== -1) {
    for (const line of lines.slice(start + 1)) {
      const rawName = /\bmenuitem\s+"([^"]*)"/.exec(line)?.[1];
      if (rawName === undefined) continue;
      landmarks.push({
        label: stripRowDecorations(rawName),
        rawName,
        current: /\(current\)/i.test(rawName),
      });
    }
  }
  return {
    expanded: expandedState(snapshot, "bbx-nav-place") === true,
    fixedRowsPresent: FIXED_MENU_IDS.every((id) => hasDomId(snapshot, id)),
    landmarks,
    // The apostrophe is a typographic one in the JSX and renders as such;
    // accept the ASCII spelling too rather than let a copy edit blind us.
    errored:
      snapshot.includes(MENU_ERROR_TEXT) || snapshot.includes("Couldn't load this menu"),
  };
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
  if (reading.landmarks.length === 0) {
    return new PlaceMenuNoLandmarksError(snapshot);
  }
  return null;
}

/**
 * The landmark the place pill currently names, or null if it is not rendered.
 *
 * The pill's accessible name is `Where you are: <label>` (PlacePill.tsx), and
 * that label is the user-visible answer to "where am I" — which makes it the
 * thing to assert a switch against.
 */
export function currentPlaceLabel(snapshot: string): string | null {
  const line = snapshot.split("\n").find((candidate) => candidate.includes("id=bbx-nav-place"));
  if (line === undefined) return null;
  return /"Where you are:\s*([^"]*)"/.exec(line)?.[1]?.trim() ?? null;
}

/**
 * A landmark worth switching TO — one the menu does not mark as current.
 *
 * Identity comes from the menu's own `(current)` marker, not from comparing the
 * row's label against the place pill's. The pill shows an undecorated label
 * while the row may carry a fresh count, so a name comparison picks the row you
 * are already standing in and then fails when selecting it does not move you —
 * a false red on a perfectly healthy box.
 *
 * The pill label is still used as a fallback for boxes that render no current
 * marker (you are in no landmark at all, which is where a fresh chat starts).
 */
export function switchTarget(input: {
  landmarks: readonly LandmarkRow[];
  current: string | null;
}): LandmarkRow | null {
  return input.landmarks.find((row) => !row.current && row.label !== input.current) ?? null;
}

/**
 * Did selecting a landmark actually take us there?
 *
 * Asserts the consequence, never the click: `bin/browse click` dispatches a
 * mouse event at the element's box centre and reports success whether or not
 * anything happened (issues/closed/bugs/2026-08-21-browse-click-on-a-ref-does-not-dispatch.md).
 *
 * Both conditions matter and they fail differently. The pill still naming the
 * old place is the 2026-08-20 bug's shape — the menu worked, the selection did
 * not move you. An unchanged URL is a click that never navigated at all.
 */
export function placeSwitchFailure(input: {
  /** The target's label with the menu's decorations removed. */
  target: string;
  /** The target's name exactly as the row rendered it. */
  targetRaw: string;
  urlBefore: string;
  urlAfter: string;
  labelAfter: string | null;
  /** Did the app report itself settled after the click? */
  settled: boolean;
  snapshot: string;
}): SmokeFailureError | null {
  // A timed-out readiness wait does not fail the step by itself — the
  // assertions below are the verdict — but it changes what a failure means,
  // and "we may have looked too early" is the first thing to check.
  const slow = input.settled
    ? ""
    : " (the app never reported itself settled after the click, so this may be slowness rather than a dead switch)";
  if (input.urlAfter === input.urlBefore) {
    return new PlaceSwitchDidNotNavigateError({
      target: input.target,
      url: input.urlAfter,
      slow,
      snapshot: input.snapshot,
    });
  }
  // Accept the row's name with decorations stripped OR exactly as rendered: a
  // landmark legitimately called "Chapter 3" is indistinguishable from
  // "Chapter" carrying three fresh items, and guessing wrong either way fails a
  // healthy box. Both readings are the same landmark; neither is the wrong one.
  if (input.labelAfter !== input.target && input.labelAfter !== input.targetRaw) {
    return new PlaceSwitchDidNotTakeError({
      target: input.target,
      labelAfter: input.labelAfter,
      slow,
      snapshot: input.snapshot,
    });
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

/**
 * The box's content-area directory row (`_content`, displayed as "Content" —
 * `shared/display-path.ts` — one-root's only open-vocabulary area at the box
 * root — `core/landmark/root-dir.ts`). The browse root deliberately lists the
 * underscore areas rather than the box's real content (`one-root-box-layout.md`),
 * so a freshly migrated box's root listing carries no card row at all; this is
 * how the card-open step finds where the actual content lives instead of
 * misreading that as a broken box.
 */
export function contentAreaRow(snapshot: string): { role: "button"; name: string } | null {
  // The sidebar shows the area's DISPLAY label ("Content"), not its raw
  // underscore name — `display-path.ts`, "Display-path vocabulary".
  const prefix = `button "${areaDisplayLabel(LANDMARK_CONTENT_DIR)} directory`;
  for (const line of snapshot.split("\n")) {
    const at = line.indexOf(prefix);
    if (at === -1) continue;
    const rest = line.slice(at + "button \"".length);
    const end = rest.indexOf('"');
    if (end === -1) continue;
    return { role: "button", name: rest.slice(0, end) };
  }
  return null;
}
