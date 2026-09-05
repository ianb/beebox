import assert from "node:assert/strict";
import test from "node:test";
import type { SmokeFailureError } from "./smoke-errors.js";
import {
  MENU_ERROR_TEXT,
  cardViewRendered,
  contentAreaRow,
  currentPlaceLabel,
  directoryRowCount,
  expandedState,
  firstCardRow,
  hasDomId,
  menuItemNames,
  placeMenuFailure,
  placeSwitchFailure,
  readPlaceMenu,
  refFor,
  stripRowDecorations,
  switchTarget,
  type LandmarkRow,
} from "./smoke-snapshot.js";

const MENU_SNAPSHOT = `- navigation "Primary" [ref=e1]
  - button "Where you are: Chat" [expanded=true, ref=e12, id=bbx-nav-place]
- menuitem "Box: test1 ›" [ref=e2, id=bbx-switch-menu-box]
- menuitem "All landmarks →" [ref=e3, id=bbx-switch-menu-landmarks]
- menuitem "Recent files ›" [ref=e4, id=bbx-switch-menu-recent-files]
- StaticText "SWITCH TO"
- menuitem "Box" [ref=e5]
- menuitem "Acids & Bases" [ref=e6]`;

test("readPlaceMenu: fixed rows are excluded, landmarks are what is left", () => {
  const reading = readPlaceMenu(MENU_SNAPSHOT);
  assert.equal(reading.expanded, true);
  assert.equal(reading.fixedRowsPresent, true);
  assert.deepEqual(reading.landmarks.map((row) => row.label), ["Box", "Acids & Bases"]);
  assert.equal(reading.errored, false);
  assert.equal(placeMenuFailure(reading, MENU_SNAPSHOT), null);
});

test("placeMenuFailure: the error row wins over every other reading", () => {
  // The 2026-08-26 escape: the menu opened and looked structurally fine, but
  // its landmark query had died on broken global Codex state. Reporting
  // "collapsed" or "no landmarks" there sends someone to the wrong layer.
  const snapshot = `${MENU_SNAPSHOT}\n- StaticText "${MENU_ERROR_TEXT} — Retry"`;
  const failure = placeMenuFailure(readPlaceMenu(snapshot), snapshot);
  assert.match(failure?.message ?? "", /could not load its landmarks/);
});

test("placeMenuFailure: the ASCII apostrophe spelling is caught too", () => {
  const snapshot = `${MENU_SNAPSHOT}\n- StaticText "Couldn't load this menu — Retry"`;
  assert.equal(readPlaceMenu(snapshot).errored, true);
});

test("placeMenuFailure: a click that did not open the menu", () => {
  const collapsed = MENU_SNAPSHOT.replace("expanded=true", "expanded=false");
  const failure = placeMenuFailure(readPlaceMenu(collapsed), collapsed);
  assert.match(failure?.message ?? "", /did not open the menu/);
});

test("placeMenuFailure: fixed rows but no landmarks is its own failure", () => {
  const empty = MENU_SNAPSHOT.split("\n").slice(0, 5).join("\n");
  const failure = placeMenuFailure(readPlaceMenu(empty), empty);
  assert.match(failure?.message ?? "", /lists no landmarks/);
});

test("expandedState: absent element is null, not false", () => {
  // False would read as "the menu is closed" for an app bar that never
  // rendered — a different bug with a different fix.
  assert.equal(expandedState(MENU_SNAPSHOT, "bbx-nav-place"), true);
  assert.equal(expandedState(MENU_SNAPSHOT, "bbx-nav-missing"), null);
});

test("refFor: resolves role + name, and tolerates regex metacharacters in the name", () => {
  assert.equal(refFor(MENU_SNAPSHOT, { role: "menuitem", name: "Box" }), "e5");
  assert.equal(refFor(MENU_SNAPSHOT, { role: "menuitem", name: "Acids & Bases" }), "e6");
  assert.equal(refFor(MENU_SNAPSHOT, { role: "button", name: "Where you are: Chat" }), "e12");
  assert.equal(refFor(MENU_SNAPSHOT, { role: "menuitem", name: "Box (nope)" }), null);
});

// ── selecting a landmark ────────────────────────────────────────────────────

test("currentPlaceLabel: reads the pill's `Where you are: <label>` accessible name", () => {
  assert.equal(currentPlaceLabel(MENU_SNAPSHOT), "Chat");
  assert.equal(
    currentPlaceLabel('- button "Where you are: Acids & Bases" [expanded=false, ref=e5, id=bbx-nav-place]'),
    "Acids & Bases",
  );
  assert.equal(currentPlaceLabel('- button "User" [ref=e8, id=bbx-nav-profile]'), null);
});

test("switchTarget: never the place we are already in", () => {
  // Switching to where you already are asserts nothing — the pill reads the
  // same afterwards whether or not the navigation worked.
  const row = (label: string): LandmarkRow => ({ label, rawName: label, current: false });
  assert.equal(
    switchTarget({ landmarks: [row("Box"), row("Acids & Bases")], current: "Box" })?.label,
    "Acids & Bases",
  );
  assert.equal(
    switchTarget({ landmarks: [row("Box"), row("Acids & Bases")], current: "Chat" })?.label,
    "Box",
  );
  assert.equal(switchTarget({ landmarks: [row("Box")], current: "Box" }), null);
  assert.equal(switchTarget({ landmarks: [], current: null }), null);
  // The menu's own marker wins over a label comparison: a row carrying a fresh
  // count reads as a different name than the pill, and selecting the place you
  // are already in proves nothing.
  assert.equal(
    switchTarget({
      landmarks: [{ label: "Box", rawName: "Box (current)", current: true }, row("Elsewhere")],
      current: null,
    })?.label,
    "Elsewhere",
  );
});

test("placeSwitchFailure: a click that never navigated", () => {
  const failure = placeSwitchFailure({
    target: "Acids & Bases",
    targetRaw: "Acids & Bases",
    urlBefore: "http://x/chat",
    urlAfter: "http://x/chat",
    labelAfter: "Chat",
    settled: true,
    snapshot: "",
  });
  assert.match(failure?.message ?? "", /did not navigate/);
});

test("placeSwitchFailure: the page moved but the place did not — the 2026-08-20 shape", () => {
  // The menu listed every landmark and reported no problems; selecting one
  // coined a fresh chat in the same place instead of moving you. A URL check
  // alone passes that, which is why the pill is asserted too.
  const failure = placeSwitchFailure({
    target: "Acids & Bases",
    targetRaw: "Acids & Bases",
    urlBefore: "http://x/chat",
    urlAfter: "http://x/chat?session=new",
    labelAfter: "Chat",
    settled: true,
    snapshot: "",
  });
  assert.match(failure?.message ?? "", /still names "Chat"/);
});

test("placeSwitchFailure: arriving where we aimed passes", () => {
  assert.equal(
    placeSwitchFailure({
      target: "Acids & Bases",
      targetRaw: "Acids & Bases",
      urlBefore: "http://x/chat",
      urlAfter: "http://x/chat?contextDir=store%2Fcourses%2FAcids_Bases.attach",
      labelAfter: "Acids & Bases",
      settled: true,
      snapshot: "",
    }),
    null,
  );
});

test("readPlaceMenu: nav-card rows above 'Switch to' are not landmarks", () => {
  // A box with nav entries renders them as plain menuitems before the section
  // header (PlacePill-panels.tsx, NavCardRows). Counting those as landmarks
  // let the walk try to switch to a route.
  const snapshot = `- button "Where you are: Chat" [expanded=true, ref=e1, id=bbx-nav-place]
- menuitem "Box: test1 ›" [ref=e2, id=bbx-switch-menu-box]
- menuitem "All landmarks →" [ref=e3, id=bbx-switch-menu-landmarks]
- menuitem "Recent files ›" [ref=e4, id=bbx-switch-menu-recent-files]
- menuitem "Today's questions" [ref=e5]
- StaticText "SWITCH TO"
- menuitem "Box" [ref=e6]
- menuitem "Acids & Bases" [ref=e7]`;
  const reading = readPlaceMenu(snapshot);
  assert.deepEqual(reading.landmarks.map((r) => r.label), ["Box", "Acids & Bases"]);
  assert.equal(reading.fixedRowsPresent, true);
});

test("readPlaceMenu: a menu with no 'Switch to' section lists no landmarks", () => {
  // Fails closed. Silently treating every menuitem as a landmark is how the
  // nav-card rows got in.
  const snapshot = `- button "Where you are: Chat" [expanded=true, ref=e1, id=bbx-nav-place]
- menuitem "Recent files ›" [ref=e4, id=bbx-switch-menu-recent-files]`;
  assert.deepEqual(readPlaceMenu(snapshot).landmarks, []);
});

test("stripRowDecorations: the menu's additions are not part of the label", () => {
  // The pill carries neither, so comparing a decorated row name against it
  // fails a healthy box.
  assert.equal(stripRowDecorations("Acids & Bases 2"), "Acids & Bases");
  assert.equal(stripRowDecorations("Box (current)"), "Box");
  assert.equal(stripRowDecorations("Box (current) 7"), "Box");
  // A landmark legitimately named "Chapter 3" is indistinguishable from
  // "Chapter" with three fresh items. Stripping is therefore only ever used to
  // OFFER a reading — placeSwitchFailure accepts the raw name too, so neither
  // reading fails a healthy box.
  assert.equal(stripRowDecorations("Chapter 3"), "Chapter");
});

test("readPlaceMenu: the current row is marked, not just named", () => {
  const snapshot = `- button "Where you are: Box" [expanded=true, ref=e1, id=bbx-nav-place]
- menuitem "Box: test1 ›" [ref=e2, id=bbx-switch-menu-box]
- menuitem "All landmarks →" [ref=e3, id=bbx-switch-menu-landmarks]
- menuitem "Recent files ›" [ref=e4, id=bbx-switch-menu-recent-files]
- StaticText "SWITCH TO"
- menuitem "Box (current)" [ref=e6]
- menuitem "Acids & Bases 3" [ref=e7]`;
  const reading = readPlaceMenu(snapshot);
  assert.deepEqual(
    reading.landmarks.map((r) => ({ label: r.label, current: r.current })),
    [{ label: "Box", current: true }, { label: "Acids & Bases", current: false }],
  );
  // And the target is the one we are not standing in — by the marker, even
  // though "Acids & Bases 3" also differs from the pill's "Box" by name.
  const target = switchTarget({ landmarks: reading.landmarks, current: currentPlaceLabel(snapshot) });
  assert.equal(target?.label, "Acids & Bases");
  assert.equal(target?.rawName, "Acids & Bases 3");
});

test("placeSwitchFailure: an unsettled app is named as a possible cause", () => {
  const failure = placeSwitchFailure({
    target: "Acids & Bases",
    targetRaw: "Acids & Bases",
    urlBefore: "http://x/chat",
    urlAfter: "http://x/chat",
    labelAfter: "Chat",
    settled: false,
    snapshot: "",
  });
  assert.match(failure?.message ?? "", /never reported itself settled/);
});

test("placeSwitchFailure: a label that really ends in a number is not a mismatch", () => {
  // "Chapter 3" the landmark vs "Chapter" with 3 fresh items look identical in
  // the row's accessible name. Accepting both readings is what keeps a healthy
  // box out of the red; only a genuinely different place fails.
  const both = (labelAfter: string): SmokeFailureError | null =>
    placeSwitchFailure({
      target: "Chapter",
      targetRaw: "Chapter 3",
      urlBefore: "http://x/chat",
      urlAfter: "http://x/chat?contextDir=chapters%2F3",
      labelAfter,
      settled: true,
      snapshot: "",
    });
  assert.equal(both("Chapter 3"), null);
  assert.equal(both("Chapter"), null);
  assert.match(both("Somewhere else")?.message ?? "", /still names "Somewhere else"/);
});

test("readPlaceMenu: an interactive-only snapshot yields nothing, and says so", () => {
  // The section header is StaticText, which `snapshot -i` omits. Feeding it one
  // finds no landmarks at all rather than silently treating nav rows as
  // landmarks — the walk fails loudly instead of switching to a route.
  const interactiveOnly = `- button "Where you are: Chat" [expanded=true, ref=e1, id=bbx-nav-place]
- menuitem "Box: test1 ›" [ref=e2, id=bbx-switch-menu-box]
- menuitem "All landmarks →" [ref=e3, id=bbx-switch-menu-landmarks]
- menuitem "Recent files ›" [ref=e4, id=bbx-switch-menu-recent-files]
- menuitem "Box" [ref=e5]`;
  const reading = readPlaceMenu(interactiveOnly);
  assert.deepEqual(reading.landmarks, []);
  assert.match(placeMenuFailure(reading, interactiveOnly)?.message ?? "", /lists no landmarks/);
});

test("menuItemNames / hasDomId read the snapshot as written", () => {
  assert.equal(menuItemNames(MENU_SNAPSHOT).length, 5);
  assert.equal(hasDomId(MENU_SNAPSHOT, "bbx-nav-place"), true);
  assert.equal(hasDomId(MENU_SNAPSHOT, "bbx-composer-input"), false);
});

const BROWSE_SNAPSHOT = `- button "/" [ref=e26, id=bbx-browse-crumb-root]
- button "box directory, 791 items" [ref=e10]
- button "docs directory" [ref=e12]
- button "Box, landmark card" [ref=e18]
- button "briefing card" [ref=e19]
- button "AGENTS.md" [ref=e20]`;

test("cardViewRendered: a mounted frame with no card in it is not a rendered card", () => {
  assert.equal(cardViewRendered('- heading "Box" [level=2, ref=e26]'), true);
  assert.equal(cardViewRendered('- link "Open full view →" [ref=e27, id=bbx-browse-open-card]'), false);
  // The page's own h1 is not the card's title.
  assert.equal(cardViewRendered('- heading "Browse" [level=1, ref=e3]'), false);
});

test("directoryRowCount / firstCardRow: counted rows come from real box content", () => {
  assert.equal(directoryRowCount(BROWSE_SNAPSHOT), 2);
  assert.deepEqual(firstCardRow(BROWSE_SNAPSHOT), { role: "button", name: "Box, landmark card" });
  assert.equal(directoryRowCount("- button \"/\" [ref=e1]"), 0);
  assert.equal(firstCardRow("- button \"AGENTS.md\" [ref=e1]"), null);
});

test("contentAreaRow: finds the one-root content area when a listing has no card row", () => {
  const oneRootRoot = `- button "/" [ref=e16, id=bbx-browse-crumb-root]
- button "_bookkeeping directory, 659 items" [ref=e11]
- button "_config directory, 28 items" [ref=e12]
- button "_content directory, 184 items" [ref=e13]
- button "_publish directory" [ref=e14]
- button "_tmp directory" [ref=e15]`;
  assert.deepEqual(contentAreaRow(oneRootRoot), {
    role: "button",
    name: "_content directory, 184 items",
  });
  // A pre-one-root box's listing carries no `_content` row at all.
  assert.equal(contentAreaRow(BROWSE_SNAPSHOT), null);
});
