// # bbx view check: check states
//
// Every view renders with no card. A view that renders card types also renders
// with the first card of each type in the box, by path, that loads, as
// `params.path`. A type with no card that loads is reported untested
// (docs/implemented-plans/view-check-settled-render.md, Track 1). Then each
// state the view declares in `checkStates`, by name
// (docs/implemented-plans/view-declared-check-states.md).

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { statesToCheck, partialRemarks, snapshotOf, PARTIAL_PREFIX, SNAPSHOT_MAX_BYTES } from "../../../../src/cli/commands/view/check-states.js";

const boxCardPaths = [
  "_content/recipes/Stew.recipe.card",
  "_content/recipes/Bread.recipe.card",
  "_content/recipes/Apple.recipe.card",
  "_content/notes/Plan.doc.card",
];

// Apple sorts first but does not load, so Bread is the sample.
const loads = (p: string) => Promise.resolve(!p.includes("Apple"));

void test("a card-type view gets one state per type, with the first card by path that loads", async (t) => {
  await t.check(statesToCheck({ rendersCardTypes: ["recipe", "menu"], declared: [], boxCardPaths, loads }), {
    states: [
      { label: "no card", params: {} },
      { label: "_content/recipes/Bread.recipe.card", params: { path: "_content/recipes/Bread.recipe.card" } },
    ],
    untested: ["no menu card among the cards the view receives (its dependencies); not checked with one"],
  });
});

void test("a view that renders no card types renders with no card only", async (t) => {
  await t.check(statesToCheck({ rendersCardTypes: [], declared: [], boxCardPaths, loads }), { states: [{ label: "no card", params: {} }], untested: [] });
});

// A declared state follows the automatic ones, its card as `params.path`. A
// declared card that does not load, or whose type the view does not render
// (the app never opens the view on it), is reported, not failed: a moved card
// must not wedge the check.
void test("declared states come after the automatic ones; an unreachable card is reported", async (t) => {
  await t.check(statesToCheck({
    rendersCardTypes: ["recipe"],
    declared: [
      { name: "selected", path: "_content/recipes/Stew.recipe.card", params: { select: "O" } },
      { name: "gone", path: "_content/recipes/Apple.recipe.card" },
      { name: "other-type", path: "_content/notes/Plan.doc.card" },
    ],
    boxCardPaths,
    loads,
  }), {
    states: [
      { label: "no card", params: {} },
      { label: "_content/recipes/Bread.recipe.card", params: { path: "_content/recipes/Bread.recipe.card" } },
      { label: "selected", params: { select: "O", path: "_content/recipes/Stew.recipe.card" } },
    ],
    untested: [
      "state gone: _content/recipes/Apple.recipe.card is not among the cards the view receives; not checked",
      "state other-type: the view does not render doc cards (rendersCardTypes), so the app never opens it on _content/notes/Plan.doc.card; not checked",
    ],
  });
});

// The sweep reads only the prefixed lines; anything else the view prints is ignored.
void test("partial remarks are the prefixed stdout lines", (t) => {
  t.check(partialRemarks(`hello from the view\n${PARTIAL_PREFIX}no card: still loading after 5s\n`), ["no card: still loading after 5s"]);
  t.end();
});

// The limit counts the UTF-8 bytes of the state's JSON as written: two
// million `界` are 2,000,000 characters but 6,000,000 bytes.
void test("a state over SNAPSHOT_MAX_BYTES as written keeps no HTML", async (t) => {
  const wide = "界".repeat(2_000_000);
  t.check([
    SNAPSHOT_MAX_BYTES,
    snapshotOf("wide", { html: `<p>${wide}</p>`, headStyles: [] }).html === null,
    snapshotOf("ascii", { html: "<p>ok</p>", headStyles: ["p {}"] }),
  ], [5_000_000, true, { label: "ascii", html: "<p>ok</p>", headStyles: ["p {}"] }]);
});
