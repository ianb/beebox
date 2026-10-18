// # Reserved field names and the global title
//
// A card schema may not declare a global field (`title`, `contains`, …) or a
// banned name (`status`, `created`, `summary`, `date`, `modified`, `source`).
// `reservedFieldProblems` (`src/cards/reserved-fields.ts`) reports them with
// what to write instead. Built-in schemas are held to it here; box-local
// schemas still load and get a health warning (`box-schema-fields`). See
// `docs/implemented-plans/standard-card-fields.md`.

import { test } from "tap";
import "agent-doctest/tap";
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
const PENDING_REMOVAL = new Set<string>();

function loads(text: string, schemas: Map<string, ReturnType<typeof cardSchema>>): string {
  try {
    parseCardText(text, { source: "a.note-fixture.card", schemas });
    return "loaded";
  } catch (_e) {
    return "rejected";
  }
}

const found = cardSchemas.list.flatMap((s) => reservedFieldProblems(s).map((p) => `${s.type}.${p.field}`));

// ## Built-in schemas declare no reserved name outside the pending list
void test("Built-in schemas declare no reserved name outside the pending list", async (t) => {
  // doctest:L40
  t.check(found.filter((name) => !PENDING_REMOVAL.has(name)), []);

  // doctest:L43
  t.check([...PENDING_REMOVAL].filter((name) => !found.includes(name)), []);
});

// ## A schema that redeclares a global or uses a banned name is reported
//
// The message says what to write instead.
void test("The message says what to write instead.", async (t) => {
  const widget = cardSchema("widget", {
    fields: {
      title: z.string().optional(),
      status: z.enum(["new", "done"]),
      created: z.string(),
      weight: z.number(),
    },
  });
  t.check(reservedFieldProblems(widget), [
    {
      field: "title",
      message: "`title` is a global field every card already has; redeclare it only to require it (`title: z.string()`)",
    },
    {
      field: "status",
      message: "`status` is a reserved field name: record the specific fact instead: a named boolean per state (`archived: true`), a specifically named enum (`operating: open | closed`), the presence of the result, or an error field",
    },
    {
      field: "created",
      message: "`created` is a reserved field name: git records when a card was written; a media capture time belongs on the media reference",
    },
  ]);


});

// ## Declaring `title` as required is allowed, and the title leads the frontmatter
//
// The one allowed redeclaration makes the global title required. A card of that
// type fails to load without a title. Parse order is serialization order, so
// `title` comes first wherever the type declares it.
void test("The one allowed redeclaration makes the global title required.", async (t) => {
  // doctest:L77
  const note = cardSchema("note-fixture", {
    fields: { mood: z.string().optional(), title: z.string(), body: body(z.string()) },
  });
  t.check(reservedFieldProblems(note), []);

  // doctest:L83
  // Anything other than a required string is still shadowing.
  const shadowed = { field: "title", message: "`title` is a global field every card already has; redeclare it only to require it (`title: z.string()`)" };
  const titleAs = (decl: z.ZodType) => reservedFieldProblems(cardSchema("t", { fields: { title: decl } }));
  t.check([z.string(), z.string().optional(), z.string().default("Untitled"), z.string().nullable(), z.number()].map(titleAs), [
    [],
    [shadowed],
    [shadowed],
    [shadowed],
    [shadowed],
  ]);

  // doctest:L88
  const schemas = new Map([["note-fixture", note]]);

  // doctest:L90
  t.check(loads("---\nmood: calm\n---\nBody.\n", schemas), "rejected");

  // doctest:L93
  const card = parseCardText("---\nmood: calm\ntitle: Tuesday\n---\nBody.\n", { source: "a.note-fixture.card", schemas });
  t.check(serializeCardText({ schema: note, fields: card.fields }), `---
title: Tuesday
mood: calm
---
Body.
`);
});

// ## One title for listings and search: the declared title wins over a derived one
//
// `cardTitle` is what both the file summary and the search index use. A person
// is titled by its `name`, unless the card declares its own `title:`.
void test("cardTitle is what both the file summary and the search index use.", async (t) => {
  // doctest:L104
  const person = cardSchemas.list.find((s) => s.type === "person");
  if (person === undefined) throw new Error("person schema missing");
  const input = { path: "people/Dana_Reyes.person.card", type: "person", fields: { type: "person", name: "Dana Reyes", body: "" } };
  t.check(cardTitle(input, person), "Dana Reyes");

  // doctest:L110
  t.check(cardTitle({ ...input, fields: { ...input.fields, title: "Dana (neighbor)" } }, person), "Dana (neighbor)");
});
