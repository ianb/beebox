// # Derived children in the resolved link list
//
// Track B (`docs/implemented-plans/card-prominence.md`) splices a landmark's pruned subtree
// (`prominence-index.ts`) into `resolveLandmark`'s flat list: hand-listed
// `links` first, then derived `entry-point` cards, then derived `primary`
// cards, then nested landmarks, then unnamed `expand` results — deduped by ref
// across every tier, first wins. Each resolved link now carries `source`
// (`"listed" | "derived" | "expand" | "place"`) and, for a derived card or a
// nested place, `prominence`. A nested landmark's row is `"place"`, since its
// `prominence` alone cannot tell it from a derived card.

import { test } from "tap";
import "agent-doctest/tap";
import { resolveLandmark } from "../../../src/core/landmark/resolve/core.js";
import { createCardSchemaMap } from "../../../src/schemas.js";
import { prunedSubtree } from "../../../src/core/landmark/prominence-index.js";
import { makeTmpBox } from "../../helpers/test-helpers.js";

/** The fields the assertions below care about, in list order. */
function summarize(links: { ref: string; label: string | null; source: string; prominence?: string }[]) {
  return links.map((l) => ({ ref: l.ref, label: l.label, source: l.source, prominence: l.prominence ?? null }));
}

// ## Tier order: entry-point, then primary, then nested landmarks, then expand
void test("Tier order: entry-point, then primary, then nested landmarks, then expand", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L27
  const box = await makeTmpBox();
  await box.write("_content/Spot.landmark.card", "---\nnavigation:\n  label: Spot\n  expand:\n    - query: Extra.doc.card\n---\n");
  await box.write("_content/Extra.doc.card", "---\n---\n");
  await box.write("_content/Idx.doc.card", "---\nprominence: entry-point\n---\n");
  await box.write("_content/Plan.doc.card", "---\nprominence: primary\n---\n");
  await box.write("_content/Sub/Sub.landmark.card", "---\nnavigation:\n  label: Sub\n---\n");

  // doctest:L34
  const derived = await prunedSubtree(box.root, "");
  const { links } = await resolveLandmark(
    { label: "Spot", expand: [{ query: "Extra.doc.card" }] },
    { landmarkDir: box.path("_content"), landmarkPath: "_content/Spot.landmark.card", boxRoot: box.root, cardSchemas: await createCardSchemaMap(box.root), derived },
  );

  // doctest:L40
  t.check(summarize(links), [
    {
      ref: "_content/Idx.doc.card",
      label: null,
      source: "derived",
      prominence: "entry-point",
    },
    {
      ref: "_content/Plan.doc.card",
      label: null,
      source: "derived",
      prominence: "primary",
    },
    {
      ref: "_content/Sub/Sub.landmark.card",
      label: "Sub",
      source: "place",
      prominence: "background",
    },
    {
      ref: "_content/Extra.doc.card",
      label: null,
      source: "expand",
      prominence: null,
    },
  ]);
});

// ## A hand-listed link wins the dedup against the same card, derived
//
// The card is BOTH `links:`-listed (with a label) and marked `primary` — the
// listed entry wins, keeping its label and `source: "listed"`; the derived
// tier adds no row for that ref. The derived tier's level stays on the listed
// link as its `prominence`, so the place page can still show the card in that
// tier.
void test("The card is BOTH links:-listed (with a label) and marked primary — the listed...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L83
  const box = await makeTmpBox();
  await box.write("_content/Plan.doc.card", "---\nprominence: primary\n---\n");

  // doctest:L86
  const derived = await prunedSubtree(box.root, "");
  const { links } = await resolveLandmark(
    { label: "Spot", links: [{ ref: "/_content/Plan.doc.card", label: "the plan" }] },
    { landmarkDir: box.path("_content"), landmarkPath: "_content/Spot.landmark.card", boxRoot: box.root, cardSchemas: await createCardSchemaMap(box.root), derived },
  );

  // doctest:L92
  t.check(summarize(links), [
    {
      ref: "_content/Plan.doc.card",
      label: "the plan",
      source: "listed",
      prominence: "primary",
    },
  ]);
});

// A place may list its own entry point. The listed row is the only row for it,
// and it carries `prominence: "entry-point"`.
void test("A place may list its own entry point.", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L112
  const box = await makeTmpBox();
  await box.write("_content/List.doc.card", "---\nprominence: entry-point\n---\n");
  await box.write("_content/Other.doc.card", "---\n---\n");

  // doctest:L116
  const derived = await prunedSubtree(box.root, "");
  const { links } = await resolveLandmark(
    { label: "Spot", links: [{ ref: "/_content/List.doc.card", label: "the list" }, { ref: "/_content/Other.doc.card" }] },
    { landmarkDir: box.path("_content"), landmarkPath: "_content/Spot.landmark.card", boxRoot: box.root, cardSchemas: await createCardSchemaMap(box.root), derived },
  );

  // doctest:L122
  t.check(summarize(links), [
    {
      ref: "_content/List.doc.card",
      label: "the list",
      source: "listed",
      prominence: "entry-point",
    },
    {
      ref: "_content/Other.doc.card",
      label: null,
      source: "listed",
      prominence: null,
    },
  ]);
});

// ## No `derived` input: unchanged, listed-then-expand only
//
// Omitting `derived` (the identity-only callers, and any resolver call that
// doesn't want derivation) behaves exactly as before Track B.
void test("Omitting derived (the identity-only callers, and any resolver call that doesn...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L136
  const box = await makeTmpBox();
  await box.write("_content/Bread.recipe.card", "---\ntitle: Bread\n---\n");

  // doctest:L139
  const { links, derivedProblems } = await resolveLandmark(
    { label: "Recipes", links: [{ ref: "Bread.recipe.card" }] },
    { landmarkDir: box.path("_content"), landmarkPath: "_content/Recipes.landmark.card", boxRoot: box.root, cardSchemas: await createCardSchemaMap(box.root) },
  );

  // doctest:L144
  t.check(summarize(links), [
    {
      ref: "_content/Bread.recipe.card",
      label: null,
      source: "listed",
      prominence: null,
    },
  ]);

  // doctest:L155
  await t.checkText(derivedProblems.length, "0");
});

// ## A link's title is the card's `title:` field
//
// A slugged filename loses punctuation, so a link titled from it reads like a
// filename ("Cake Carrier Marisol"). The resolver reads the target card's
// `title:` and falls back to the filename only when the card has none.
void test("A slugged filename loses punctuation, so a link titled from it reads like a f...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L170
  const box = await makeTmpBox();
  await box.write("_content/Cake_Carrier_Marisol.doc.card", "---\ntitle: Cake carrier (Marisol's)\nprominence: primary\n---\n");
  await box.write("_content/Ladder.doc.card", "---\nprominence: primary\n---\n");

  // doctest:L174
  const derived = await prunedSubtree(box.root, "");
  const { links } = await resolveLandmark(
    { label: "Spot" },
    { landmarkDir: box.path("_content"), landmarkPath: "_content/Spot.landmark.card", boxRoot: box.root, cardSchemas: await createCardSchemaMap(box.root), derived },
  );

  // doctest:L180
  t.check(links.map((l) => l.title), [
    "Cake carrier (Marisol's)",
    "Ladder",
  ]);
});

// ## A nested landmark's row opens its entry point
//
// A nested landmark's row used to open the landmark card itself, a page that
// shows only the landmark's configuration. When the nested place has an
// `entry-point` card, the row opens that card; the label stays the landmark's.
// A nested landmark without one still opens its landmark card.
void test("A nested landmark's row used to open the landmark card itself, a page that sh...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L196
  const box = await makeTmpBox();
  await box.write("_content/Inventory/Inventory.landmark.card", "---\nnavigation:\n  label: Inventory\n---\n");
  await box.write("_content/Inventory/Index.doc.card", "---\nprominence: entry-point\n---\n");
  await box.write("_content/Garden/Garden.landmark.card", "---\nnavigation:\n  label: Garden\n---\n");

  // doctest:L201
  const derived = await prunedSubtree(box.root, "");
  const { links } = await resolveLandmark(
    { label: "Home" },
    { landmarkDir: box.path("_content"), landmarkPath: "_content/Home.landmark.card", boxRoot: box.root, cardSchemas: await createCardSchemaMap(box.root), derived },
  );

  // doctest:L207
  t.check(links.map((l) => ({ ref: l.ref, label: l.label })), [
    {
      ref: "_content/Garden/Garden.landmark.card",
      label: "Garden",
    },
    {
      ref: "_content/Inventory/Index.doc.card",
      label: "Inventory",
    },
  ]);
});
