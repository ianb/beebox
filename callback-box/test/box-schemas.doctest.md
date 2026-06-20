# Box-Local Schemas

Boxes define their own card types under `config/schemas/*.ts`. Each file
default-exports a frontmatter `cardSchema()`. `loadBoxSchemas` discovers them and
they become first-class in the same parse/validate path as built-in ones.

```ts setup
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { initBox } from "../src/core/box.js";
import { loadBoxSchemas, createCardSchemaMap } from "../src/schemas/registry.js";
import { buildLoadContext } from "../src/core/load-context.js";
import { loadCardFromText } from "../src/core/card-io.js";

async function makeTmpBox() {
  const box = await fs.mkdtemp(path.join(os.tmpdir(), "cb-boxschemas-"));
  await initBox(box, { skipGit: true });
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
```

## Loading discovers box frontmatter schemas

```
const box = await makeTmpBox();
await fs.writeFile(path.join(box, "config/schemas/widget.ts"), WIDGET_SCHEMA);

const loaded = await loadBoxSchemas(box);
[loaded.cardSchemas.length, loaded.cardSchemas[0].type].join("|")
=> 1|widget
```

## Box frontmatter cards load and validate

`buildLoadContext` merges box frontmatter schemas into the same map built-in cards use, so a
`widget` card parses as the new format with its YAML fields and markdown body:

``` continue
const ctx = await buildLoadContext(box);
const card = await loadCardFromText({ content: WIDGET_CARD, source: "My.widget.card", ctx });
[card.kind, card.schema.type, card.fields.size, card.fields.status, card.fields.body].join("|")
=> frontmatter|widget|3|new|Hello widget body.
```

Validation rejects a malformed card — `size` must be a number:

``` continue
const bad = "---\nsize: not-a-number\n---\n";
await loadErrorName(bad, "X.widget.card", ctx)
=> CardIOError
```

## The box type is a first-class entry in the card-schema map

`createCardSchemaMap(boxRoot)` includes box frontmatter types alongside the built-ins:

``` continue
const map = await createCardSchemaMap(box);
map.has("widget")
=> true
```

``` cleanup
await fs.rm(box, { recursive: true, force: true });
```
