// # Choosing the "Also here" cards
//
// `alsoHere(ordinary, { shownRefs, cap })` picks the place page's "Also here"
// cards from the pruned walk's ordinary list (docs/implemented-plans/place-shows-cards.md,
// Track A): it drops cards already shown, orders the rest most recently changed
// first with the path as tie-break, and caps the list while counting all of
// them.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { alsoHere } from "../../src/shared/also-here.js";

const card = (boxPath: string, mtimeMs: number) => ({ boxPath, mtimeMs });
const paths = (cards: { boxPath: string }[]) => cards.map((c) => c.boxPath);

// ## Shown cards are dropped; shown refs have no leading "/"
void test("Shown cards are dropped; shown refs have no leading \"/\"", async (t) => {
  const pick = alsoHere(
    [card("/_content/A.doc.card", 1), card("/_content/B.doc.card", 3), card("/_content/C.doc.card", 2)],
    { shownRefs: new Set(["_content/B.doc.card"]), cap: 10 },
  );
  t.check(({ cards: paths(pick.cards), count: pick.count }), {
    cards: [
      "/_content/C.doc.card",
      "/_content/A.doc.card",
    ],
    count: 2,
  });
});

// ## The cap limits the cards, not the count
void test("The cap limits the cards, not the count", async (t) => {
  const pick = alsoHere(
    [card("/a", 1), card("/b", 2), card("/c", 3), card("/d", 4)],
    { shownRefs: new Set(), cap: 2 },
  );
  t.check(({ cards: paths(pick.cards), count: pick.count }), {
    cards: [
      "/d",
      "/c",
    ],
    count: 4,
  });
});

// ## Equal mtimes sort by path, numbers by value
void test("Equal mtimes sort by path, numbers by value", async (t) => {
  t.check(paths(alsoHere([card("/x10", 5), card("/x2", 5), card("/w", 5)], { shownRefs: new Set(), cap: 10 }).cards), [
    "/w",
    "/x2",
    "/x10",
  ]);
});

// ## Nothing left is an empty selection
void test("Nothing left is an empty selection", async (t) => {
  t.check(alsoHere([card("/a", 1)], { shownRefs: new Set(["a"]), cap: 10 }), {
    cards: [],
    count: 0,
  });
});
