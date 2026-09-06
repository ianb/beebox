# `status.browse` — the listing carries prominence

Track C of `docs/implemented-plans/card-prominence.md`: `status.browse` adds each
card's effective `prominence`, each subdirectory's pruned-subtree
`DirectorySummary` (plus its own landmark identity when it has one), and
the listed directory's own `background` cascade. No doctest previously
exercised `status.browse`'s general listing shape (only the namespace-fence
suite in `box-namespace-fence-traversal.doctest.md` calls it, for security);
this is that doctest.

```ts setup
import { makeTestServer } from "../helpers/doctest-server.js";
import { statusRouter } from "../../src/webapp/trpc/routers/status.js";

interface TestCtx {
  boxRoot: string;
  boxSlug: string;
  user: null;
  authed: boolean;
  isOwner: boolean;
}

function ctxFor(boxRoot: string): TestCtx {
  return { boxRoot, boxSlug: "t", user: null, authed: true, isOwner: true };
}
```

## A card's own declared level, and a card's type default

An `entry-point`/`primary`/`background`-declared card reports that level; an
undeclared card falls back to its type's default — `ordinary` for a memo,
`background` for a landmark (its type default, per Track A).

```ts
const server = await makeTestServer();
await server.seed("_content/Entry.memo.card", "---\nprominence: entry-point\n---\n");
await server.seed("_content/Primary.memo.card", "---\nprominence: primary\n---\n");
await server.seed("_content/Plain.memo.card", "---\n---\n");
await server.seed("_content/Log.contains-backfill-job.card", "---\ndescription: test\nitems: []\n---\n");
await server.seed("_content/Box.landmark.card", "---\nnavigation:\n  label: Box\n---\n");

const listing = await statusRouter.createCaller(ctxFor(server.boxRoot)).browse({ path: "_content" });
listing.cards
  .map((c) => `${c.name}:${c.prominence}`)
  .sort()
  .join(" ")
=> Box:background Entry:entry-point Log:background Plain:ordinary Primary:primary
```

The listed directory itself is not background — nothing here cascaded it.

```ts continue
listing.background
=> false
```

```ts cleanup
await server.cleanup();
```

## A subdirectory's `DirectorySummary` and own landmark identity

A subdirectory holding a primary card reports it in its `summary`; one with
its own landmark card carries that landmark's label/symbol; a plain
subdirectory summarizes to nothing prominent.

```ts
const server2 = await makeTestServer();
// "Cookbook", not "recipes": the default test box already scaffolds
// `_content/recipes/`, and macOS's case-insensitive filesystem would
// collide a same-named-but-cased directory into it.
await server2.seed("_content/Cookbook/Cookbook.landmark.card", "---\nnavigation:\n  label: Cookbook\n---\n");
await server2.seed("_content/Cookbook/Soup.recipe.card", "---\nprominence: primary\n---\n");
await server2.seed("_content/Plain/Notes.memo.card", "---\n---\n");

const listing2 = await statusRouter.createCaller(ctxFor(server2.boxRoot)).browse({ path: "_content" });
const byName = new Map(listing2.dirs.map((d) => [d.name, d]));

JSON.stringify(byName.get("Cookbook")?.summary)
=> {"hasEntryPoint":false,"primaryCount":1,"background":false}

byName.get("Cookbook")?.landmark?.label
=> Cookbook

JSON.stringify(byName.get("Plain")?.summary)
=> {"hasEntryPoint":false,"primaryCount":0,"background":false}

byName.get("Plain")?.landmark
=> undefined
```

```ts cleanup
await server2.cleanup();
```

## The listed directory's own `background` cascade

A directory whose own landmark is written `background` reports
`background: true` at the top level — the page folds everything into
"more" regardless of any individual card's level (Track C's `foldListing`).

```ts
const server3 = await makeTestServer();
await server3.seed("_content/Housekeeping/Housekeeping.landmark.card", "---\nprominence: background\n---\n");
await server3.seed("_content/Housekeeping/Notable.memo.card", "---\nprominence: entry-point\n---\n");

const bgListing = await statusRouter.createCaller(ctxFor(server3.boxRoot)).browse({ path: "_content/Housekeeping" });
bgListing.background
=> true

bgListing.cards.find((c) => c.name === "Notable")?.prominence
=> entry-point
```

```ts cleanup
await server3.cleanup();
```
