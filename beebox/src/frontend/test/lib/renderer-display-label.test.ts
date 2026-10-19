// # Renderer display labels (view-tab copy)
//
// `rendererDisplayLabel` (`lib/renderer-display-label.ts`) maps a registered
// renderer's `name` — the `?view=` identity, unchanged — to the text
// `RendererToggle` shows on the tab: the generic "Card" renderer shows the
// card's own type when nothing more specific claims the file, or "Details"
// when a type-specific renderer already does; "Source" reads as "Original
// text" for card files. Everything else passes through.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { rendererDisplayLabel } from "../../src/lib/renderer-display-label.js";

// ## "Card" shows the humanized card type when nothing more specific exists
void test("\"Card\" shows the humanized card type when nothing more specific exists", async (t) => {
  t.check(rendererDisplayLabel({ registeredName: "Card", filePath: "Bread.recipe.card", hasTypeSpecificRenderer: false }), "Recipe");

  t.check(rendererDisplayLabel({ registeredName: "Card", filePath: "_content/plate.concept-map.card", hasTypeSpecificRenderer: false }), "Concept map");
});

// ## "Card" reads as "Details" once a type-specific renderer claims the file
void test("\"Card\" reads as \"Details\" once a type-specific renderer claims the file", async (t) => {
  t.check(rendererDisplayLabel({ registeredName: "Card", filePath: "Bread.recipe.card", hasTypeSpecificRenderer: true }), "Details");
});

// ## An unrecognizable path falls back to the registered name, never breaks
void test("An unrecognizable path falls back to the registered name, never breaks", async (t) => {
  t.check(rendererDisplayLabel({ registeredName: "Card", filePath: "no-type-here.card", hasTypeSpecificRenderer: false }), "Card");

  t.check(rendererDisplayLabel({ registeredName: "Card", filePath: "", hasTypeSpecificRenderer: false }), "Card");
});

// ## "Source" reads as "Original text" for card files only
void test("\"Source\" reads as \"Original text\" for card files only", async (t) => {
  t.check(rendererDisplayLabel({ registeredName: "Source", filePath: "Bread.recipe.card", hasTypeSpecificRenderer: false }), "Original text");

  t.check(rendererDisplayLabel({ registeredName: "Source", filePath: "notes.md", hasTypeSpecificRenderer: false }), "Source");
});

// ## Every other renderer name is unchanged
void test("Every other renderer name is unchanged", async (t) => {
  t.check(rendererDisplayLabel({ registeredName: "Recipe", filePath: "Bread.recipe.card", hasTypeSpecificRenderer: true }), "Recipe");
});
