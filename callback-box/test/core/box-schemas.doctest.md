# Box-Local Schemas

Boxes define their own card types under `config/schemas/*.ts`. Each file
default-exports a frontmatter `cardSchema()`. `loadBoxSchemas` discovers them and
they become first-class in the same parse/validate path as built-in ones.

```ts setup
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { initBox } from "../../src/core/box/index.js";
import { loadBoxSchemas, createCardSchemaMap, invalidateBoxSchemas } from "../../src/schemas/registry.js";
import { getTemplate } from "../../src/schemas/templates.js";
import { buildLoadContext } from "../../src/core/load-context.js";
import { loadCardFromText } from "../../src/core/card-io.js";

// This file exercises box-local schemas in the LEGACY (v1) layout —
// `config/schemas/*.ts` resolved via the resolve-hook fakery. The v2
// (package-layout) equivalent lives in test/schemas/box-schemas-v2.doctest.md.
// `initBox`'s default is now v2, so the legacy shape is opted into explicitly
// with shapeVersion 1 (a flat box whose root is its own package root).
async function makeTmpBox() {
  const box = await fs.mkdtemp(path.join(os.tmpdir(), "cb-boxschemas-"));
  await initBox(box, { skipGit: true, shapeVersion: 1 });
  return box;
}

// Returns the error class name when a card fails to load, or "no-error".
async function loadErrorName(content, source, ctx) {
  try {
    await loadCardFromText({ content, source, ctx });
    return "no-error";
  } catch (e) {
    return e.constructor.name;
  }
}

// A frontmatter card type: config in YAML + a markdown body. Box-local
// frontmatter schemas import the card primitives via the public
// `callback-box/cards` specifier (resolved by the tsx hook in registry.ts).
const WIDGET_SCHEMA = `import { body, cardSchema } from "callback-box/cards";
import { z } from "zod";

export default cardSchema("widget", {
  fields: {
    status: z.enum(["new", "done"]).default("new"),
    size: z.number(),
    body: body(z.string()),
  },
  instructions: "# Widget Cards\\n\\nA box-local frontmatter card type.",
});
`;

const WIDGET_CARD = `---
size: 3
---
Hello widget body.
`;

// Same widget type, with an extra "color" field — used to prove an edit is
// picked up after invalidation.
const WIDGET_SCHEMA_V2 = WIDGET_SCHEMA.replace(
  "size: z.number(),",
  "size: z.number(), color: z.string().optional(),",
);

// A syntactically broken schema (truncated mid-call) — used to prove
// keep-last-good: a bad save must not blank a working type.
const WIDGET_SCHEMA_BROKEN = `import { cardSchema } from "callback-box/cards";
export default cardSchema(`;

// A box-local schema that also exports a `template` (for `cb create`), plus a
// variant without one — used to prove owner-scoped template (de)registration.
const TRIP_WITH_TEMPLATE = `import { cardSchema } from "callback-box/cards";
import { z } from "zod";

export const template = {
  name: "trip-template",
  description: "A trip",
  argsSchema: z.object({ dest: z.string() }),
  generate: (args) => "---\\ndest: " + args.dest + "\\n---\\n",
  cardTypes: ["trip"],
};

export default cardSchema("trip", { fields: { dest: z.string() } });
`;

const TRIP_NO_TEMPLATE = `import { cardSchema } from "callback-box/cards";
import { z } from "zod";

export default cardSchema("trip", { fields: { dest: z.string() } });
`;
```

## Loading discovers box frontmatter schemas

```ts
const box = await makeTmpBox();
await fs.writeFile(path.join(box, "config/schemas/widget.ts"), WIDGET_SCHEMA);

const loaded = await loadBoxSchemas(box);
[loaded.cardSchemas.length, loaded.cardSchemas[0].type].join("|")
=> 1|widget
```

## Box frontmatter cards load and validate

`buildLoadContext` merges box frontmatter schemas into the same map built-in cards use, so a
`widget` card parses as the new format with its YAML fields and markdown body:

```ts continue
const ctx = await buildLoadContext(box);
const card = await loadCardFromText({ content: WIDGET_CARD, source: "My.widget.card", ctx });
[card.kind, card.schema.type, card.fields.size, card.fields.status, card.fields.body].join("|")
=> frontmatter|widget|3|new|Hello widget body.
```

Validation rejects a malformed card — `size` must be a number:

```ts continue
const bad = "---\nsize: not-a-number\n---\n";
await loadErrorName(bad, "X.widget.card", ctx)
=> CardIOError
```

## The box type is a first-class entry in the card-schema map

`createCardSchemaMap(boxRoot)` includes box frontmatter types alongside the built-ins:

```ts continue
const map = await createCardSchemaMap(box);
map.has("widget")
=> true
```

```ts cleanup
await fs.rm(box, { recursive: true, force: true });
```

## Edits hot-reload after invalidation (content-hash cache-bust)

A long-lived server caches the assembled schema set (and Node permanently caches
`import()` by URL), so an on-disk edit is invisible until `invalidateBoxSchemas`
drops the cache. The next load content-hash-busts the changed file and sees it.

```ts
const rbox = await makeTmpBox();
const wpath = path.join(rbox, "config/schemas/widget.ts");
await fs.writeFile(wpath, WIDGET_SCHEMA);
const v1 = await loadBoxSchemas(rbox);
"color" in v1.cardSchemas[0].frontmatterSchema.shape
=> false

await fs.writeFile(wpath, WIDGET_SCHEMA_V2);

// Without invalidation: the cached set is returned — edit not yet visible.
const stale = await loadBoxSchemas(rbox);
"color" in stale.cardSchemas[0].frontmatterSchema.shape
=> false

// After invalidation: the changed file is re-imported, edit visible.
invalidateBoxSchemas(rbox);
const fresh = await loadBoxSchemas(rbox);
"color" in fresh.cardSchemas[0].frontmatterSchema.shape
=> true
```

## Keep-last-good: a broken save doesn't blank a working type

If a re-import fails (an incomplete mid-edit save), the loader keeps the file's
last good schema rather than dropping the type. A real deletion does drop it.

```ts continue
await fs.writeFile(wpath, WIDGET_SCHEMA_BROKEN);
invalidateBoxSchemas(rbox);
const kept = await loadBoxSchemas(rbox);
kept.cardSchemas.map(s => s.type).join(",")
=> widget

await fs.rm(wpath);
invalidateBoxSchemas(rbox);
const dropped = await loadBoxSchemas(rbox);
dropped.cardSchemas.length
=> 0
```

```ts cleanup
await fs.rm(rbox, { recursive: true, force: true });
```

## Templates are owner-scoped across boxes

The template registry is process-global, but registrations are tagged by box.
Two boxes can register the same-named template; one box dropping its copy on
reload must not remove the other's, and only when the last owner drops it does
the name disappear.

```ts
const boxA = await makeTmpBox();
const boxB = await makeTmpBox();
await fs.writeFile(path.join(boxA, "config/schemas/trip.ts"), TRIP_WITH_TEMPLATE);
await fs.writeFile(path.join(boxB, "config/schemas/trip.ts"), TRIP_WITH_TEMPLATE);
await loadBoxSchemas(boxA);
await loadBoxSchemas(boxB);
getTemplate("trip-template") !== undefined
=> true

// boxA drops its template (reload without it); boxB still owns it.
await fs.writeFile(path.join(boxA, "config/schemas/trip.ts"), TRIP_NO_TEMPLATE);
invalidateBoxSchemas(boxA);
await loadBoxSchemas(boxA);
getTemplate("trip-template") !== undefined
=> true

// boxB drops it too — now the name is gone.
await fs.writeFile(path.join(boxB, "config/schemas/trip.ts"), TRIP_NO_TEMPLATE);
invalidateBoxSchemas(boxB);
await loadBoxSchemas(boxB);
getTemplate("trip-template") === undefined
=> true
```

Deleting a box's last schema file (so the dir scan is empty) must drop its
templates too, not just its card types:

```ts continue
await fs.writeFile(path.join(boxA, "config/schemas/trip.ts"), TRIP_WITH_TEMPLATE);
invalidateBoxSchemas(boxA);
await loadBoxSchemas(boxA);
getTemplate("trip-template") !== undefined
=> true

await fs.rm(path.join(boxA, "config/schemas/trip.ts"));
invalidateBoxSchemas(boxA);
const after = await loadBoxSchemas(boxA);
[after.cardSchemas.length, getTemplate("trip-template") === undefined].join("|")
=> 0|true
```

```ts cleanup
await fs.rm(boxA, { recursive: true, force: true });
await fs.rm(boxB, { recursive: true, force: true });
```
