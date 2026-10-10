# Agent guide — Card Types section

`cardTypesList` fills the `{{card_types}}` placeholder of the "## CARD_TYPES"
section (`guide.md`) from the box's frontmatter card schemas: grouped by
`category` (authored / synced / system), each type with its `brief` (five
words or fewer), or its one-line `description` when it has no brief.

It takes `CardSchema[]` and lists each by its `.type`. This regressed once: it
took the legacy XML `ElementSchema[]` (`.tagName`), which is empty since every
schema became frontmatter — so the agent guide's Card Types section rendered
empty.

```ts setup
import { cardTypesList } from "../../../../src/core/agent-guide/guide/cards.js";
import { generateAgentGuide } from "../../../../src/core/agent-guide/guide/core.js";
import { cardSchemas } from "../../../../src/schemas.js";
import { cardSchema, type CardSchema } from "../../../../src/exports/cards.js";
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

const text = cardTypesList({ allCardSchemas: [authored, system] });
const lines = text.split("\n");
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

## The brief wins over the description, and every built-in has one

The list is read on every turn, so each entry is the type's `brief`, five
words or fewer; the longer `description` is the package-docs index row. A
schema without a brief (a box-local one) falls back to its description.

```ts
const briefed: CardSchema = cardSchema("memo", {
  brief: "A captured note",
  description: "a captured text or voice note awaiting processing",
  category: "authored",
  fields: { status: z.string() },
});
cardTypesList({ allCardSchemas: [briefed] }).split("\n").includes("- **memo** — A captured note")
=> true

// Every built-in schema declares a brief of at most five words
cardSchemas.list.filter((s) => s.brief === undefined || s.brief.split(/\s+/).length > 5).map((s) => s.type)
=> []
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

const text = cardTypesList({ allCardSchemas: [builtinMemo, boxMemo, boxOnly], boxCardSchemas: [boxMemo, boxOnly] });
const lines = text.split("\n");
lines.filter((l) => l.startsWith("- **memo**")).join(" | ")
=> - **memo** — this box's memo → `_content/docs/generated/card-memo.md`

lines.includes("- **widget** — a box-local type → `_content/docs/generated/card-widget.md`")
=> true
```

## A description-less schema (e.g. box-local) still lists, defaulting to authored

```ts
const bare: CardSchema = cardSchema("widget", { fields: { size: z.string() } });

const text = cardTypesList({ allCardSchemas: [bare] });
const lines = text.split("\n");
lines.includes("- **widget**")
=> true

lines.some((l) => l.startsWith("**Types you create"))
=> true
```

## An empty schema list still renders the section (no crash)

With no schemas the list is empty, and the section keeps its heading and
prose with one blank line between paragraphs.

```ts
JSON.stringify(cardTypesList({ allCardSchemas: [] }))
=> ""

const guide = generateAgentGuide({ procedures: [], shape: { shapeVersion: 3, boxRoot: "/tmp/box" }, instructionFile: "AGENTS.md", allCardSchemas: [] });
const section = guide.split("## CARD_TYPES\n")[1]?.split("\n## ")[0] ?? "";
const paragraphs = section.trim().split("\n\n");
[paragraphs.length, section.includes("\n\n\n")].join("|")
=> 2|false
```
