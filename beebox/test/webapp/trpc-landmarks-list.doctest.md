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
import { mkdir, symlink } from "node:fs/promises";
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
// The v3 root landmark lives at `_content/Box.landmark.card`, not at the
// literal box root (`root-dir.ts`) — a card sitting directly at the box
// root is outside every underscore area and, since the namespace fence
// findings (round 4 hardening), correctly excluded from the scan.
await box.write("_content/Box.landmark.card", "---\nnavigation:\n  label: Home\n---\n\n");

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
=> {"path":"_content/Box.landmark.card","dir":"","label":"Kitchen","symbol":{"glyph":"🍳"}}
```

```ts cleanup
await box.cleanup();
```

## `setHqPreference`/`hqPreferences`/`forDir` reject a `dir` outside the box namespace

Finding 3 (Track E hardening review, round 3): the input `refine` only
rejected an escaping form (`..`/leading `/`) — a real, non-underscore
directory like `src/templates` passed it and named a physical directory the
landmark writer then read/wrote into directly. Every landmark procedure
taking `dir` now resolves it through the box namespace fence (write mode for
the mutation) and rejects a non-namespace `dir` with `BAD_REQUEST`.

`setHqPreference`/`hqPreferences` are `ownerProcedure` (secret-custody:
mutating box config is owner-only) — a caller needs `isOwner: true` to reach
the namespace check at all:

```ts
function ownerCaller(boxRoot) {
  const ctx = {
    boxRoot,
    boxSlug: "test",
    eventBus: { emit: () => 0, emitTransient: () => {}, readSince: () => [], subscribe: () => ({ unsubscribe: () => {} }), prune: () => 0, close: () => {} },
    services: {},
    user: null,
    authed: true,
    isOwner: true,
  };
  return appRouter.createCaller(ctx);
}

const box = await makeTmpBox();
await mkdir(box.path("src/templates"), { recursive: true });
await box.write("src/templates/Private.landmark.card", "---\nnavigation:\n  label: Private\n---\n");

async function throwsBadRequest(fn) {
  try {
    await fn();
    return false;
  } catch (e) {
    return e?.code === "BAD_REQUEST" || `${e}`.includes("BAD_REQUEST");
  }
}

const setRejected = await throwsBadRequest(() =>
  ownerCaller(box.root).landmarks.setHqPreference({ dir: "src/templates", value: "on" }),
);
const hqRejected = await throwsBadRequest(() =>
  ownerCaller(box.root).landmarks.hqPreferences({ dir: "src/templates" }),
);
const forDirRejected = await throwsBadRequest(() =>
  caller(box.root).landmarks.forDir({ dir: "src/templates" }),
);
JSON.stringify({ setRejected, hqRejected, forDirRejected })
=> {"setRejected":true,"hqRejected":true,"forDirRejected":true}
```

The card outside the namespace is untouched by the rejected write:

```ts continue
(await box.read("src/templates/Private.landmark.card")).includes("hq-dictation")
=> false
```

`dir: ""` (the root scope, physically `_content/`) still works — the fence
only rejects a dir that isn't in ANY underscore area:

```ts continue
await box.write("_content/Box.landmark.card", "---\nnavigation:\n  label: Root\n---\n");
const rootPref = await ownerCaller(box.root).landmarks.hqPreferences({ dir: "" });
JSON.stringify({ hasLandmark: rootPref.hasLandmark })
=> {"hasLandmark":true}
```

```ts cleanup
await box.cleanup();
```

## A symlinked landmark card that escapes the box namespace is skipped, not read through

Finding 2 (round 4 hardening): `_content/escape/A.landmark.card` is a symlink
to `src/private.landmark.card` — outside every underscore area. It still
matches the `**/*.landmark.card` glob `list`/`forDir` scan with, but its
bytes belong to a file outside the namespace, so it must never be read
through. A normal (non-symlinked) landmark elsewhere in the box still loads.

```ts
const box = await makeTmpBox();
await box.write("src/private.landmark.card", "---\nnavigation:\n  label: Private\n---\n");
await box.write("_content/recipes/Recipes.landmark.card", "---\nnavigation:\n  label: Recipes\n---\n");
await mkdir(box.path("_content/escape"), { recursive: true });
await symlink(box.path("src/private.landmark.card"), box.path("_content/escape/A.landmark.card"));

const { landmarks, problems } = await caller(box.root).landmarks.list();
JSON.stringify({ labels: landmarks.map((l) => l.label).toSorted(), problemCount: problems.length })
=> {"labels":["Recipes"],"problemCount":0}
```

`forDir` on the escaping symlink's directory answers `null` (same as any
other unreadable card — no landmark to render), while the normal landmark's
directory still resolves:

```ts continue
const { landmark: escaped } = await caller(box.root).landmarks.forDir({ dir: "_content/escape" });
const { landmark: recipes } = await caller(box.root).landmarks.forDir({ dir: "_content/recipes" });
JSON.stringify({ escaped, recipesLabel: recipes?.label })
=> {"escaped":null,"recipesLabel":"Recipes"}
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
