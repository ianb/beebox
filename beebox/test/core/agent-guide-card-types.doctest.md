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

const text = cardTypesSection([authored, system]);
const lines = text.split("\n");
lines.includes("## CARD_TYPES")
=> true

lines.includes("- **memo** — a captured note")
=> true

lines.includes("- **chat-job** — reactor bookkeeping")
=> true

// The authored group renders before the system group
lines.findIndex((l) => l.startsWith("**Types you create")) < lines.findIndex((l) => l.startsWith("**System bookkeeping"))
=> true

// The per-type doc location is stated once up front, not per line
lines.filter((l) => l.includes("_content/docs/generated/card-")).length
=> 1
```

## A description-less schema (e.g. box-local) still lists, defaulting to authored

```ts
const bare: CardSchema = cardSchema("widget", { fields: { size: z.string() } });

const text = cardTypesSection([bare]);
const lines = text.split("\n");
lines.includes("- **widget**")
=> true

lines.some((l) => l.startsWith("**Types you create"))
=> true
```

## An empty schema list still renders the header (no crash)

```ts
const text = cardTypesSection([]);
const lines = text.split("\n");
lines[0]
=> ## CARD_TYPES
```
