# Reserved field names and the global title

A card schema may not declare a global field (`title`, `contains`, …) or a
banned name (`status`, `created`, `summary`, `date`, `modified`, `source`).
`reservedFieldProblems` (`src/cards/reserved-fields.ts`) reports them with
what to write instead. Built-in schemas are held to it here; box-local
schemas still load and get a health warning (`box-schema-fields`). See
`docs/plans/standard-card-fields.md`.

```ts setup
import { z } from "zod";
import { cardSchema, body } from "../../src/exports/cards.js";
import { reservedFieldProblems } from "../../src/cards/reserved-fields.js";
import { cardSchemas } from "../../src/schemas.js";
import { parseCardText, serializeCardText } from "../../src/core/card-io.js";
import { cardTitle } from "../../src/core/loader-registry.js";

/**
 * Built-in fields that still carry a reserved name, until parts 2 and 3 of
 * the plan remove them. The list only shrinks: the test below fails when an
 * entry is no longer present, so each removal also deletes its line here.
 */
const PENDING_REMOVAL = new Set([
  "browser-task.source",
  "commentary.source", "email-message.date",
  "gdoc.modified",
  "gsheet.modified", "memo.created",
  "memo.source", "memo.status",
  "recipe.source", "tab-arrangement.source",
  "webpage.source",
]);

function loads(text: string, schemas: Map<string, ReturnType<typeof cardSchema>>): string {
  try {
    parseCardText(text, { source: "a.note-fixture.card", schemas });
    return "loaded";
  } catch (_e) {
    return "rejected";
  }
}

const found = cardSchemas.list.flatMap((s) => reservedFieldProblems(s).map((p) => `${s.type}.${p.field}`));
```

## Built-in schemas declare no reserved name outside the pending list

```ts
found.filter((name) => !PENDING_REMOVAL.has(name))
=> []

[...PENDING_REMOVAL].filter((name) => !found.includes(name))
=> []
```

## A schema that redeclares a global or uses a banned name is reported

The message says what to write instead.

```ts
const widget = cardSchema("widget", {
  fields: {
    title: z.string().optional(),
    status: z.enum(["new", "done"]),
    created: z.string(),
    weight: z.number(),
  },
});
reservedFieldProblems(widget).map((p) => p.field).join(", ")
=> title, status, created

reservedFieldProblems(widget)[0]?.message
=> `title` is a global field every card already has; redeclare it only to require it (`title: z.string()`)

reservedFieldProblems(widget)[1]?.message.startsWith("`status` is a reserved field name: record the specific fact instead")
=> true
```

## Declaring `title` as required is allowed, and the title leads the frontmatter

The one allowed redeclaration makes the global title required. A card of that
type fails to load without a title. Parse order is serialization order, so
`title` comes first wherever the type declares it.

```ts
const note = cardSchema("note-fixture", {
  fields: { mood: z.string().optional(), title: z.string(), body: body(z.string()) },
});
reservedFieldProblems(note)
=> []

// Anything other than a required string is still shadowing.
const titleAs = (decl: z.ZodType) => reservedFieldProblems(cardSchema("t", { fields: { title: decl } })).length;
[z.string(), z.string().optional(), z.string().default("Untitled"), z.string().nullable(), z.number()].map(titleAs).join(",")
=> 0,1,1,1,1

const schemas = new Map([["note-fixture", note]]);

loads("---\nmood: calm\n---\nBody.\n", schemas)
=> rejected

const card = parseCardText("---\nmood: calm\ntitle: Tuesday\n---\nBody.\n", { source: "a.note-fixture.card", schemas });
JSON.stringify(serializeCardText({ schema: note, fields: card.fields }))
=> "---\ntitle: Tuesday\nmood: calm\n---\nBody.\n"
```

## One title for listings and search: the declared title wins over a derived one

`cardTitle` is what both the file summary and the search index use. A person
is titled by its `name`, unless the card declares its own `title:`.

```ts
const person = cardSchemas.list.find((s) => s.type === "person");
if (person === undefined) throw new Error("person schema missing");
const input = { path: "people/Dana_Reyes.person.card", type: "person", fields: { type: "person", name: "Dana Reyes", body: "" } };
cardTitle(input, person)
=> Dana Reyes

cardTitle({ ...input, fields: { ...input.fields, title: "Dana (neighbor)" } }, person)
=> Dana (neighbor)
```
