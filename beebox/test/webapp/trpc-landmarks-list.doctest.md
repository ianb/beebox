# `landmarks.list`: broken landmark cards are reported, not skipped

`landmarks.list` is the Landmarks page's reader — the merged activity surface
(`docs/implemented-plans/top-nav-ia.md` Track D) renders one section per landmark from it.
A `*.landmark.card` whose frontmatter doesn't parse used to vanish from that
page without a trace; now it comes back in `problems`, the same shape
`chat.byLandmark` reports, so the page can dedupe the two by path and show a
single warning row.

An unreadable file (an fs error) is a different failure: it warns on the server
and appears in neither list, since there's nothing to say about a card we never
read.

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

## The good landmarks load; the broken one is named

```ts
const box = await makeTmpBox();

await box.write("_content/recipes/Recipes.landmark.card",
  "---\nnavigation:\n  label: Recipes\n  symbol: \"🍳\"\n---\n\n");
await box.write("_content/trips/Trips.landmark.card", "no frontmatter here at all\n");

const { landmarks, problems } = await caller(box.root).landmarks.list();
print(`landmarks: ${landmarks.map((l) => `${l.label} (${l.dir})`).join(" | ")}`);
print(`problems: ${problems.map((p) => p.path).join(",")}`);
=>
landmarks: Recipes (_content/recipes)
problems: _content/trips/Trips.landmark.card
```

Fixing the card empties `problems` — the report tracks the file, it isn't
sticky.

```ts continue
await box.write("_content/trips/Trips.landmark.card",
  "---\nnavigation:\n  label: Trips\n---\n\n");

const fixed = await caller(box.root).landmarks.list();
print(`landmarks: ${fixed.landmarks.map((l) => l.label).join(",")}`);
print(`problems: ${fixed.problems.length}`);
=>
landmarks: Recipes,Trips
problems: 0
```

A label-less card (e.g. a destinations-only triage landmark) falls back to
its filename basename — the label is never empty, so the app bar's pill
face always has something to render.

```ts continue
await box.write("_bookkeeping/archive/Old_Mail.landmark.card",
  "---\ndestinations:\n  - for: [triage]\n    rules: \"Old mail.\"\n---\n\n");

const withArchive = await caller(box.root).landmarks.list();
withArchive.landmarks.map((l) => l.label).join(",")
=> Old_Mail,Recipes,Trips
```

```ts cleanup
await box.cleanup();
```

## A box with nothing broken reports an empty list

```ts
const box = await makeTmpBox();
await box.write("Box.landmark.card", "---\nnavigation:\n  label: Home\n---\n\n");

const { landmarks, problems } = await caller(box.root).landmarks.list();
`${landmarks.length} landmark(s), ${problems.length} problem(s)`
=> 1 landmark(s), 0 problem(s)
```

```ts cleanup
await box.cleanup();
```

## `forDir({ dir: "" })` finds the root landmark under `_content/`

The one-root layout put the ROOT landmark card at `_content/Box.landmark.card`,
not at the box's physical root — but `dir: ""` still means the box-root chat
scope. `forDir` must resolve it there, not answer `null`/fall back to a
placeholder.

```ts
const box = await makeTmpBox();
await box.write("_content/Box.landmark.card", "---\nnavigation:\n  label: Kitchen\n  symbol: 🍳\n---\n");

const { landmark } = await caller(box.root).landmarks.forDir({ dir: "" });
JSON.stringify({ path: landmark?.path, dir: landmark?.dir, label: landmark?.label, symbol: landmark?.symbol })
=> {"path":"_content/Box.landmark.card","dir":"","label":"Kitchen","symbol":"🍳"}
```

```ts cleanup
await box.cleanup();
```

## `forDir` still answers null for a broken card

The here menu asks for one directory's landmark. A card that doesn't parse
means there is no landmark to render — `forDir` has no `problems` channel and
doesn't need one; the page-level surface is where the warning belongs.

```ts
const box = await makeTmpBox();
await box.write("_content/trips/Trips.landmark.card", "not a card\n");

const { landmark } = await caller(box.root).landmarks.forDir({ dir: "_content/trips" });
`${landmark}`
=> null
```

```ts cleanup
await box.cleanup();
```
