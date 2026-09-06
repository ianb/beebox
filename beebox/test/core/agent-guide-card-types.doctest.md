# Agent guide — Card Types section

`cardTypesSection` builds the "## CARD_TYPES" catalogue in the generated agent
guide from the box's frontmatter card schemas: grouped by `category`
(authored / synced / system), each type with its one-line `description`.

It takes `CardSchema[]` and lists each by its `.type`. This regressed once: it
took the legacy XML `ElementSchema[]` (`.tagName`), which is empty since every
schema became frontmatter — so the agent guide's Card Types section rendered
empty.

```ts setup
import { cardTypesSection } from "../../src/core/agent-guide/cards.js";
import { cardSchema, type CardSchema } from "../../src/cards/index.js";
import { z } from "zod";
```

## Groups by category and carries each type's description

```ts
const authored: CardSchema = cardSchema("memo", {
  description: "a captured note",
  category: "authored",
  fields: { status: z.string() },
  instructions: "How to memo.",
});
const system: CardSchema = cardSchema("chat-job", {
  description: "reactor bookkeeping",
  category: "system",
  fields: { status: z.string() },
});

const text = cardTypesSection({ allCardSchemas: [authored, system] });
const lines = text.split("\n");
lines.includes("## CARD_TYPES")
=> true

// A built-in type with instructions links its doc in the package
lines.includes("- **memo** — a captured note → `node_modules/beebox/box-docs/card-memo.md`")
=> true

lines.includes("- **chat-job** — reactor bookkeeping")
=> true

// The authored group renders before the system group
lines.findIndex((l) => l.startsWith("**Types you create")) < lines.findIndex((l) => l.startsWith("**System bookkeeping"))
=> true

// A type without instructions has no doc to link
lines.find((l) => l.startsWith("- **chat-job**"))?.includes("→")
=> false
```

## A box-local schema's doc is in the box, and a box-local type shadows a built-in

Box-local schemas live in the box's `src/schemas/` and their docs are compiled
into the box (`_content/docs/generated/`), not the package. When a box-local
schema reuses a built-in's type it shadows it (last write wins, as in
`createCardSchemaMap`), so the list carries one entry pointing at the box doc.

```ts
const builtinMemo: CardSchema = cardSchema("memo", {
  description: "a captured note",
  category: "authored",
  fields: { status: z.string() },
  instructions: "How to memo.",
});
const boxMemo: CardSchema = cardSchema("memo", {
  description: "this box's memo",
  category: "authored",
  fields: { status: z.string(), mood: z.string() },
  instructions: "How THIS box memos.",
});
const boxOnly: CardSchema = cardSchema("widget", {
  description: "a box-local type",
  category: "authored",
  fields: { size: z.string() },
  instructions: "How to widget.",
});

const text = cardTypesSection({ allCardSchemas: [builtinMemo, boxMemo, boxOnly], boxCardSchemas: [boxMemo, boxOnly] });
const lines = text.split("\n");
lines.filter((l) => l.startsWith("- **memo**")).join(" | ")
=> - **memo** — this box's memo → `_content/docs/generated/card-memo.md`

lines.includes("- **widget** — a box-local type → `_content/docs/generated/card-widget.md`")
=> true
```

## A description-less schema (e.g. box-local) still lists, defaulting to authored

```ts
const bare: CardSchema = cardSchema("widget", { fields: { size: z.string() } });

const text = cardTypesSection({ allCardSchemas: [bare] });
const lines = text.split("\n");
lines.includes("- **widget**")
=> true

lines.some((l) => l.startsWith("**Types you create"))
=> true
```

## An empty schema list still renders the header (no crash)

```ts
const text = cardTypesSection({ allCardSchemas: [] });
const lines = text.split("\n");
lines[0]
=> ## CARD_TYPES
```
