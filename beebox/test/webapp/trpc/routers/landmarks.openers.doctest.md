# Openers live on the place's landmark

An opener is a one-line first move shown on an unstarted chat in a place (and,
later, on the place page). A place carries its own openers under the landmark's
`navigation.openers`, and `landmarks.forDir` ships them on its payload, so the
chat reads the same request it already makes for the place's links
(docs/implemented-plans/landmark-arrival.md, Track B).

There is no inheritance: a place whose landmark lists no openers shows none,
and a directory with no landmark has no payload at all.

```ts setup
import { appRouter } from "../../../../src/webapp/trpc/routers.js";
import { makeTmpBox } from "../../../helpers/doctest-helpers.js";
import { LandmarkNavigation } from "../../../../src/schemas/landmark.js";

function caller(boxRoot) {
  const ctx = {
    boxRoot,
    boxSlug: "test",
    eventBus: { emit: () => 0, emitTransient: () => {}, readSince: () => [], subscribe: () => ({ unsubscribe: () => {} }), prune: () => 0, close: () => {} },
    services: {},
  };
  return appRouter.createCaller(ctx);
}

async function openersFor(boxRoot: string, dir: string) {
  const { landmark } = await caller(boxRoot).landmarks.forDir({ dir });
  return landmark === null ? null : landmark.openers;
}

/** Does this `navigation.openers` list pass the landmark schema? */
function opensOk(openers: string[]): boolean {
  return LandmarkNavigation.safeParse({ openers }).success;
}

const ROOT = "---\nnavigation:\n  label: test\n  openers:\n    - Let me tell you what this box is for.\n    - What can you do?\n---\n";
```

## The root place's openers come from the landmark under `_content/`

The root place is the logical directory `""`; its landmark lives at
`_content/*.landmark.card`. The old briefing reader joined `""` with the
briefing's name and looked at the box root, so no box showed root openers.

```ts
const box = await makeTmpBox();
await box.write("_content/Box.landmark.card", ROOT);
await openersFor(box.root, "")
=> ["Let me tell you what this box is for.", "What can you do?"]
```

## Each place has its own list, trimmed

```ts
const box = await makeTmpBox();
await box.write("_content/Box.landmark.card", ROOT);
await box.write("_content/lending/Lending.landmark.card",
  "---\nnavigation:\n  label: Lending\n  openers:\n    - \"  Who has what right now?  \"\n    - Log a new loan\n---\n");
await openersFor(box.root, "_content/lending")
=> ["Who has what right now?", "Log a new loan"]
```

## A place without openers shows none; it does not inherit the root's

A landmark with no `openers` key and a landmark with `openers: []` both answer
`[]`, even though the root lists two.

```ts
const box = await makeTmpBox();
await box.write("_content/Box.landmark.card", ROOT);
await box.write("_content/garden/Garden.landmark.card", "---\nnavigation:\n  label: Garden\n---\n");
await box.write("_content/swim/Swim.landmark.card", "---\nnavigation:\n  label: Swim\n  openers: []\n---\n");
({ garden: await openersFor(box.root, "_content/garden"), swim: await openersFor(box.root, "_content/swim") })
=> { garden: [], swim: [] }
```

## A directory with no landmark has no payload

```ts
const box = await makeTmpBox();
await box.write("_content/Box.landmark.card", ROOT);
await box.write("_content/loose/Note.memo.card", "---\ntitle: note\n---\n");
await openersFor(box.root, "_content/loose")
=> null
```

## An invalid opener makes the landmark fail to parse

An opener is a single non-blank line of at most 120 characters. A landmark
that breaks the rule does not load (the Landmarks page shows it as a parse
warning), so `forDir` answers as if there were no landmark rather than
quietly dropping the bad entry.

```ts
const box = await makeTmpBox();
await box.write("_content/broken/Broken.landmark.card",
  "---\nnavigation:\n  label: Broken\n  openers:\n    - \"\"\n---\n");
await openersFor(box.root, "_content/broken")
=> null
```

The validation, case by case. Surrounding whitespace is allowed; the length
limit is measured on the trimmed text.

```ts
({ ok: opensOk(["What can you do?"]), padded: opensOk(["  What can you do?  "]),
  limit: opensOk(["x".repeat(120)]), blank: opensOk(["   "]), empty: opensOk([""]),
  multiLine: opensOk(["Tell me about the box.\nAnd the people in it."]), long: opensOk(["x".repeat(121)]) })
=> { ok: true, padded: true, limit: true, blank: false, empty: false, multiLine: false, long: false }
```
