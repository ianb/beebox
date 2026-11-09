// # bbx view check: check states
//
// Every view renders with no card. A view that renders card types also renders
// with the first card of each type in the box, by path, that loads, as
// `params.path`. A type with no card that loads is reported untested
// (docs/implemented-plans/view-check-settled-render.md, Track 1).

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { checkStates, partialRemarks, PARTIAL_PREFIX } from "../../../../src/cli/commands/view/check-states.js";

const boxCardPaths = [
  "_content/recipes/Stew.recipe.card",
  "_content/recipes/Bread.recipe.card",
  "_content/recipes/Apple.recipe.card",
  "_content/notes/Plan.doc.card",
];

// Apple sorts first but does not load, so Bread is the sample.
const loads = (p: string) => Promise.resolve(!p.includes("Apple"));

void test("a card-type view gets one state per type, with the first card by path that loads", async (t) => {
  await t.check(checkStates({ rendersCardTypes: ["recipe", "menu"], boxCardPaths, loads }), {
    states: [
      { label: "no card", params: {} },
      { label: "_content/recipes/Bread.recipe.card", params: { path: "_content/recipes/Bread.recipe.card" } },
    ],
    untested: ["no menu card among the cards the view receives (its dependencies); not checked with one"],
  });
});

void test("a view that renders no card types renders with no card only", async (t) => {
  await t.check(checkStates({ rendersCardTypes: [], boxCardPaths, loads }), { states: [{ label: "no card", params: {} }], untested: [] });
});

// The sweep reads only the prefixed lines; anything else the view prints is ignored.
void test("partial remarks are the prefixed stdout lines", (t) => {
  t.check(partialRemarks(`hello from the view\n${PARTIAL_PREFIX}no card: still loading after 5s\n`), ["no card: still loading after 5s"]);
  t.end();
});
