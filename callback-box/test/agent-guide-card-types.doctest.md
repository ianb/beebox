# Agent guide — Card Types section

`cardTypesSection` builds the "## Card Types" catalogue in the generated agent
guide from the box's frontmatter card schemas.

It takes `CardSchema[]` and lists each by its `.type`. This regressed once: it
took the legacy XML `ElementSchema[]` (`.tagName`), which is empty since every
schema became frontmatter — so the agent guide's Card Types section rendered
empty.

```ts setup
import { cardTypesSection } from "../src/core/agent-guide/cards.js";
import { cardSchema, type CardSchema } from "../src/cards/index.js";
import { z } from "zod";
```

## Lists each card type, linking to its generated doc when it has instructions

```
const withDoc: CardSchema = cardSchema("memo", { fields: { status: z.string() }, instructions: "How to memo." });
const noDoc: CardSchema = cardSchema("widget", { fields: { size: z.string() } });

const lines = cardTypesSection([withDoc, noDoc]);
lines.includes("## Card Types")
=> true

// A schema with instructions links to its per-type doc by .type
lines.includes("- **memo** — see `docs/generated/card-memo.md`")
=> true

// A schema without instructions is listed without a doc link
lines.includes("- **widget**")
=> true

lines.some((l) => l.includes("widget") && l.includes("docs/generated"))
=> false
```

## An empty schema list still renders the header (no crash)

```
const lines = cardTypesSection([]);
lines[0]
=> ## Card Types
```
