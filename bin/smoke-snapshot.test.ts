import assert from "node:assert/strict";
import test from "node:test";
import {
  MENU_ERROR_TEXT,
  cardViewRendered,
  directoryRowCount,
  expandedState,
  firstCardRow,
  hasDomId,
  menuItemNames,
  placeMenuFailure,
  readPlaceMenu,
  refFor,
} from "./smoke-snapshot.js";

const MENU_SNAPSHOT = `- navigation "Primary" [ref=e1]
  - button "Place: Chat" [expanded=true, ref=e12, id=cb-nav-place]
- menuitem "Box: test1 ›" [ref=e2, id=cb-switch-menu-box]
- menuitem "All landmarks →" [ref=e3, id=cb-switch-menu-landmarks]
- menuitem "Recent files ›" [ref=e4, id=cb-switch-menu-recent-files]
- menuitem "Box" [ref=e5]
- menuitem "Acids & Bases" [ref=e6]`;

test("readPlaceMenu: fixed rows are excluded, landmarks are what is left", () => {
  const reading = readPlaceMenu(MENU_SNAPSHOT);
  assert.equal(reading.expanded, true);
  assert.equal(reading.fixedRowsPresent, true);
  assert.deepEqual(reading.landmarkNames, ["Box", "Acids & Bases"]);
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
  assert.equal(expandedState(MENU_SNAPSHOT, "cb-nav-place"), true);
  assert.equal(expandedState(MENU_SNAPSHOT, "cb-nav-missing"), null);
});

test("refFor: resolves role + name, and tolerates regex metacharacters in the name", () => {
  assert.equal(refFor(MENU_SNAPSHOT, { role: "menuitem", name: "Box" }), "e5");
  assert.equal(refFor(MENU_SNAPSHOT, { role: "menuitem", name: "Acids & Bases" }), "e6");
  assert.equal(refFor(MENU_SNAPSHOT, { role: "button", name: "Place: Chat" }), "e12");
  assert.equal(refFor(MENU_SNAPSHOT, { role: "menuitem", name: "Box (nope)" }), null);
});

test("menuItemNames / hasDomId read the snapshot as written", () => {
  assert.equal(menuItemNames(MENU_SNAPSHOT).length, 5);
  assert.equal(hasDomId(MENU_SNAPSHOT, "cb-nav-place"), true);
  assert.equal(hasDomId(MENU_SNAPSHOT, "cb-composer-input"), false);
});

const BROWSE_SNAPSHOT = `- button "/" [ref=e26, id=cb-browse-crumb-root]
- button "box directory, 791 items" [ref=e10]
- button "docs directory" [ref=e12]
- button "Box, landmark card" [ref=e18]
- button "briefing card" [ref=e19]
- button "AGENTS.md" [ref=e20]`;

test("cardViewRendered: a mounted frame with no card in it is not a rendered card", () => {
  assert.equal(cardViewRendered('- heading "Box" [level=2, ref=e26]'), true);
  assert.equal(cardViewRendered('- link "Open full view →" [ref=e27, id=cb-browse-open-card]'), false);
  // The page's own h1 is not the card's title.
  assert.equal(cardViewRendered('- heading "Browse" [level=1, ref=e3]'), false);
});

test("directoryRowCount / firstCardRow: counted rows come from real box content", () => {
  assert.equal(directoryRowCount(BROWSE_SNAPSHOT), 2);
  assert.deepEqual(firstCardRow(BROWSE_SNAPSHOT), { role: "button", name: "Box, landmark card" });
  assert.equal(directoryRowCount("- button \"/\" [ref=e1]"), 0);
  assert.equal(firstCardRow("- button \"AGENTS.md\" [ref=e1]"), null);
});
