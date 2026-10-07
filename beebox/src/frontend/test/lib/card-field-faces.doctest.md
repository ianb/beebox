# Which face shows each card field

`splitCardFields` decides, for every frontmatter key, whether the card front
(the reading face) or Properties (the card as an object) shows it. Each
common field has one named place; every other key is a type field. Properties
has two places: `foundBy`, its named rows for the common fields that say how
the card is found, and `properties`, its table of type fields.

```ts setup
import { COMMON_FIELDS, splitCardFields } from "../../src/lib/card-field-faces.js";
import { GLOBAL_CARD_FIELDS } from "../../../cards/schema.js";

const memo = {
  title: "Porch",
  contains: "Porch repair quotes",
  "contains-evidence": "Three quotes in the body",
  todos: [{ text: "Book the inspector" }],
  symbol: { glyph: "🏠" },
  prominence: "primary",
  theme: { name: "paper" },
  status: "new",
  created: "2026-07-01T10:00:00Z",
};
```

On a page, for a type with a body field, the front keeps only `todos`: the
title is the header and `theme` is the Appearance row, so neither appears.
The type fields `status` and `created` go to Properties' table.

```ts
splitCardFields(memo, { hasBodyField: true, mode: "page" })
=> {
  front: { todos: [{ text: "Book the inspector" }] },
  foundBy: {
    contains: "Porch repair quotes",
    "contains-evidence": "Three quotes in the body",
    symbol: { glyph: "🏠" },
    prominence: "primary",
  },
  properties: { status: "new", created: "2026-07-01T10:00:00Z" },
}
```

A bodiless type has nothing else to show on its front, so its type fields
stay there. A card whose schema is unknown (it failed validation, so
`card.get` returned `schema: null`) has no field classification, and its
fields stay on the front rather than being hidden:

```ts
splitCardFields(memo, { hasBodyField: false, mode: "page" }).front
=> { todos: [{ text: "Book the inspector" }], status: "new", created: "2026-07-01T10:00:00Z" }

splitCardFields(memo, { hasBodyField: null, mode: "chat" }).front
=> { todos: [{ text: "Book the inspector" }], status: "new", created: "2026-07-01T10:00:00Z" }
```

An embedded card has no header and no Properties face, so its title and type
fields show on the front; the "found by" fields and `theme` stay off it:

```ts
splitCardFields(memo, { hasBodyField: true, mode: "embed" })
=> {
  front: { title: "Porch", todos: [{ text: "Book the inspector" }], status: "new", created: "2026-07-01T10:00:00Z" },
  foundBy: {
    contains: "Porch repair quotes",
    "contains-evidence": "Three quotes in the body",
    symbol: { glyph: "🏠" },
    prominence: "primary",
  },
  properties: {},
}
```

`COMMON_FIELDS` names exactly the schema layer's global fields
(`GLOBAL_CARD_FIELDS`), so a new global field fails here until
`splitCardFields` gives it a place:

```ts
Object.keys(GLOBAL_CARD_FIELDS).sort()
=> ["contains", "contains-evidence", "prominence", "symbol", "theme", "title", "todos"]

[...COMMON_FIELDS].sort()
=> ["contains", "contains-evidence", "prominence", "symbol", "theme", "title", "todos"]
```
