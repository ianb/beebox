// # Agent guide — Card Types section
//
// `cardTypesList` fills the `{{card_types}}` placeholder of the "## CARD_TYPES"
// section (`guide.md`) from the box's frontmatter card schemas: grouped by
// `category` (authored / synced / system), each type with its `brief` (five
// words or fewer), or its one-line `description` when it has no brief.
//
// It takes `CardSchema[]` and lists each by its `.type`. This regressed once: it
// took the legacy XML `ElementSchema[]` (`.tagName`), which is empty since every
// schema became frontmatter — so the agent guide's Card Types section rendered
// empty.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { cardTypesList } from "../../../../src/core/agent-guide/guide/cards.js";
import { generateAgentGuide } from "../../../../src/core/agent-guide/guide/core.js";
import { cardSchemas } from "../../../../src/schemas.js";
import { cardSchema, type CardSchema } from "../../../../src/exports/cards.js";
import { z } from "zod";

// ## Groups by category and carries each type's description
void test("Groups by category and carries each type's description", async (t) => {
  // doctest:L24
  const authored: CardSchema = cardSchema("note", {
    description: "a captured note",
    category: "authored",
    fields: { status: z.string() },
    instructions: "How to note.",
  });
  const system: CardSchema = cardSchema("backfill-job", {
    description: "reactor bookkeeping",
    category: "system",
    fields: { status: z.string() },
  });

  // The authored group renders before the system group. A built-in type with
  // instructions links its doc in the package; a type without has no doc to link.
  // doctest:L36
  t.checkText(
    cardTypesList({ allCardSchemas: [authored, system] }),
    `**Types you create and edit:**

- **note** — a captured note → \`node_modules/beebox/box-docs/card-note.md\`

**System bookkeeping** — made and consumed by the machinery; don't author these:

- **backfill-job** — reactor bookkeeping`,
  );
});

// ## The brief wins over the description, and every built-in has one
//
// The list is read on every turn, so each entry is the type's `brief`, five
// words or fewer; the longer `description` is the package-docs index row. A
// schema without a brief (a box-local one) falls back to its description.
void test("The list is read on every turn, so each entry is the type's brief, five words...", async (t) => {
  // doctest:L61
  const briefed: CardSchema = cardSchema("note", {
    brief: "A captured note",
    description: "a captured text or voice note awaiting processing",
    category: "authored",
    fields: { status: z.string() },
  });
  t.checkText(
    cardTypesList({ allCardSchemas: [briefed] }),
    `**Types you create and edit:**

- **note** — A captured note`,
  );

  // doctest:L70
  t.check(
    // Every built-in schema declares a brief of at most five words
    cardSchemas.list.filter((s) => s.brief === undefined || s.brief.split(/\s+/).length > 5).map((s) => s.type),
    [],
  );
});

// ## A box-local schema's doc is in the box, and a box-local type shadows a built-in
//
// Box-local schemas live in the box's `src/schemas/` and their docs are compiled
// into the box (`_content/docs/generated/`), not the package. When a box-local
// schema reuses a built-in's type it shadows it (last write wins, as in
// `createCardSchemaMap`), so the list carries one entry pointing at the box doc.
void test("Box-local schemas live in the box's src/schemas/ and their docs are compiled...", async (t) => {
  // doctest:L83
  const builtinNote: CardSchema = cardSchema("note", {
    description: "a captured note",
    category: "authored",
    fields: { status: z.string() },
    instructions: "How to note.",
  });
  const boxNote: CardSchema = cardSchema("note", {
    description: "this box's note",
    category: "authored",
    fields: { status: z.string(), mood: z.string() },
    instructions: "How THIS box notes.",
  });
  const boxOnly: CardSchema = cardSchema("widget", {
    description: "a box-local type",
    category: "authored",
    fields: { size: z.string() },
    instructions: "How to widget.",
  });

  // doctest:L102
  t.checkText(
    cardTypesList({ allCardSchemas: [builtinNote, boxNote, boxOnly], boxCardSchemas: [boxNote, boxOnly] }),
    `**Types you create and edit:**

- **note** — this box's note → \`_content/docs/generated/card-note.md\`
- **widget** — a box-local type → \`_content/docs/generated/card-widget.md\``,
  );
});

// ## A description-less schema (e.g. box-local) still lists, defaulting to authored
void test("A description-less schema (e.g. box-local) still lists, defaulting to authored", async (t) => {
  // doctest:L114
  const bare: CardSchema = cardSchema("widget", { fields: { size: z.string() } });

  // doctest:L116
  t.checkText(
    cardTypesList({ allCardSchemas: [bare] }),
    `**Types you create and edit:**

- **widget**`,
  );
});

// ## An empty schema list still renders the section (no crash)
//
// With no schemas the list is empty, and the section keeps its heading and
// prose with one blank line between paragraphs.
void test("With no schemas the list is empty, and the section keeps its heading and pros...", async (t) => {
  // doctest:L131
  t.check(cardTypesList({ allCardSchemas: [] }), "");

  // doctest:L134
  const guide = generateAgentGuide({ procedures: [], shape: { shapeVersion: 3, boxRoot: "/tmp/box" }, instructionFile: "AGENTS.md", allCardSchemas: [] });
  const section = guide.split("## CARD_TYPES\n")[1]?.split("\n## ")[0] ?? "";
  // The section is long guide prose; the contract here is its paragraph structure.
  const paragraphs = section.trim().split("\n\n");
  t.check({ paragraphs: paragraphs.length, tripleBlank: section.includes("\n\n\n") }, { paragraphs: 2, tripleBlank: false });
});
