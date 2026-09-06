# `landmarks.identity` and `forDir`'s derived children

`landmarks.identity` is the cheap mount-path read (label, symbol, dir, the
landmark's own written `prominence`) that `PlacePill`, `DocumentIcon`,
`DocumentPlace`, and `ChatBarChrome` use instead of `forDir` — no link/expand
resolution, no pruned-subtree walk (`docs/plans/card-prominence.md`, "Split
identity from resolution"). `forDir` keeps the full payload, now including
Track B's derived children spliced into `links`.

```ts setup
import { appRouter } from "../../src/webapp/trpc/router.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";

function caller(boxRoot) {
  const ctx = {
    boxRoot,
    boxSlug: "test",
    eventBus: { emit: () => 0, emitTransient: () => {}, readSince: () => [], subscribe: () => ({ unsubscribe: () => {} }), prune: () => 0, close: () => {} },
    services: {},
  };
  return appRouter.createCaller(ctx);
}
```

## `identity` returns label/symbol/dir/prominence, no links

```ts
const box = await makeTmpBox();
await box.write(
  "_content/recipes/Recipes.landmark.card",
  "---\nnavigation:\n  label: Recipes\n  symbol: \"🍳\"\n---\n",
);
await box.write("_content/recipes/Bread.recipe.card", "---\nprominence: primary\n---\n");

const { identity } = await caller(box.root).landmarks.identity({ dir: "_content/recipes" });
JSON.stringify(identity)
=> {"path":"_content/recipes/Recipes.landmark.card","dir":"_content/recipes","label":"Recipes","symbol":{"glyph":"🍳"},"prominence":null}
```

A directory with no landmark card returns null, same as `forDir`.

```ts continue
const { identity: none } = await caller(box.root).landmarks.identity({ dir: "_content/nowhere" });
none
=> null
```

```ts cleanup
await box.cleanup();
```

## `forDir` splices derived entry-point and primary cards into `links`

```ts
const box2 = await makeTmpBox();
await box2.write("_content/recipes/Recipes.landmark.card", "---\nnavigation:\n  label: Recipes\n---\n");
await box2.write("_content/recipes/Index.memo.card", "---\nprominence: entry-point\n---\n");
await box2.write("_content/recipes/Bread.recipe.card", "---\nprominence: primary\n---\n");
await box2.write("_content/recipes/Notes.memo.card", "---\n---\n");

const { landmark } = await caller(box2.root).landmarks.forDir({ dir: "_content/recipes" });
JSON.stringify(landmark.links.map((l) => ({ ref: l.ref, source: l.source, prominence: l.prominence ?? null })))
=> [{"ref":"_content/recipes/Index.memo.card","source":"derived","prominence":"entry-point"},{"ref":"_content/recipes/Bread.recipe.card","source":"derived","prominence":"primary"}]
```

`landmarks.list` carries the same derived entries for every landmark in the
box, in `links`.

```ts continue
const { landmarks } = await caller(box2.root).landmarks.list();
const recipes = landmarks.find((l) => l.dir === "_content/recipes");
recipes.links.map((l) => l.source).join(",")
=> derived,derived
```

```ts cleanup
await box2.cleanup();
```
