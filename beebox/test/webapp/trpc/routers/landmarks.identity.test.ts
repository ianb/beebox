// # `landmarks.identity` and `forDir`'s derived children
//
// `landmarks.identity` is the cheap mount-path read (label, symbol, dir, the
// landmark's own written `prominence`) that `PlacePill`, `DocumentIcon`,
// `DocumentPlace`, and `ChatBarChrome` use instead of `forDir` — no link/expand
// resolution, no pruned-subtree walk (`docs/implemented-plans/card-prominence.md`, "Split
// identity from resolution"). `forDir` keeps the full payload, now including
// Track B's derived children spliced into `links`.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import type { TrpcContext } from "../../../../src/webapp/trpc/context.js";
import { appRouter } from "../../../../src/webapp/trpc/routers.js";
import assert from "node:assert/strict";
import { makeTmpBox } from "../../../helpers/test-helpers.js";
import { trpcContext } from "../../../helpers/trpc-context.js";

function caller(boxRoot: string) {
  const ctx: TrpcContext = trpcContext({ boxRoot, isAuthenticatedOwner: true });
  return appRouter.createCaller(ctx);
}

// ## `identity` returns label/symbol/dir/prominence, no links
void test("`identity` returns label/symbol/dir/prominence, no links", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  await box.write(
    "_content/recipes/Recipes.landmark.card",
    "---\nsymbol:\n  glyph: 🍳\nnavigation:\n  label: Recipes\n---\n",
  );
  await box.write("_content/recipes/Bread.doc.card", "---\ntitle: Bread\nprominence: primary\n---\n");

  const { identity } = await caller(box.root).landmarks.identity({ dir: "_content/recipes" });
  t.check(identity, {
    path: "_content/recipes/Recipes.landmark.card",
    dir: "_content/recipes",
    label: "Recipes",
    symbol: {
      glyph: "🍳",
    },
    prominence: null,
  });

  // A directory with no landmark card returns null, same as `forDir`.

  const { identity: none } = await caller(box.root).landmarks.identity({ dir: "_content/nowhere" });
  t.check(none, null);
});

// ## `forDir` splices derived entry-point and primary cards into `links`
void test("`forDir` splices derived entry-point and primary cards into `links`", async (t) => {
  t.teardown(async () => {
    try {
      await box2.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box2 = await makeTmpBox();
  await box2.write("_content/recipes/Recipes.landmark.card", "---\nnavigation:\n  label: Recipes\n---\n");
  await box2.write("_content/recipes/Index.doc.card", "---\ntitle: Index\nprominence: entry-point\n---\n");
  await box2.write("_content/recipes/Bread.doc.card", "---\ntitle: Bread\nprominence: primary\n---\n");
  await box2.write("_content/recipes/Notes.doc.card", "---\ntitle: Notes\n---\n");

  const { landmark } = await caller(box2.root).landmarks.forDir({ dir: "_content/recipes" });
  assert.ok(landmark);
  t.check(landmark.links.map((l) => ({ ref: l.ref, source: l.source, prominence: l.prominence ?? null })), [
    {
      ref: "_content/recipes/Index.doc.card",
      source: "derived",
      prominence: "entry-point",
    },
    {
      ref: "_content/recipes/Bread.doc.card",
      source: "derived",
      prominence: "primary",
    },
  ]);

  // `landmarks.list` carries the same derived entries for every landmark in the
  // box, in `links`.

  const { landmarks } = await caller(box2.root).landmarks.list();
  const recipes = landmarks.find((l) => l.dir === "_content/recipes");
  assert.ok(recipes);
  t.check(recipes.links.map((l) => l.source).join(","), "derived,derived");
});
