// # Card Summaries
//
// Each card type owns how it appears in a list, through its schema's `summarize`
// hook. The registry builds the base summary and the type extends or replaces it.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { DocSchema } from "../src/schemas/doc.js";
import { ImageSchema } from "../src/schemas/image/schema.js";
import { summarize } from "../src/core/loader-registry.js";
import type { CardSchema } from "../src/cards/schema.js";

const schemas = new Map<string, CardSchema>([
  ["doc", DocSchema],
  ["image", ImageSchema],
]);

function summaryOf(path: string, fields: Record<string, unknown>) {
  const type = fields["type"];
  return summarize(typeof type === "string" ? { path, type, fields } : { path, fields }, schemas);
}

// ## Doc — the base summary, title from `title:`
//
// A doc has no `summarize` hook, so its list entry is the base summary: the
// authored `title:` and no summary attributes.
void test("A doc has no summarize hook, so its list entry is the base summary:", async (t) => {
  const d1 = { type: "doc", title: "Groceries for the week", body: "Pick up milk on the way home." };
  const s = summaryOf("_content/inbox/Groceries.doc.card", d1);
  t.check(s.title, "Groceries for the week");

  t.check(s.type, "doc");

  t.check(s.attrs, undefined);
});

// ## Image — title from description field
void test("Image — title from description field", async (t) => {
  const fields1 = {
    type: "image",
    "has-text": true,
    filename: { ref: "attach/photo.jpg", via: { channel: "camera-environment", at: "2024-01-15T00:00:00Z" } },
    description: "Whiteboard with project timeline",
  };
  t.check(summaryOf("photo.image.card", fields1).title, "Whiteboard with project timeline");
});

// ## Image — falls back to filename ref
void test("Image — falls back to filename ref", async (t) => {
  const fields2 = {
    type: "image",
    filename: { ref: "photo-001.jpg", via: { channel: "camera-environment", at: "2024-01-15T00:00:00Z" } },
  };
  t.check(summaryOf("_content/inbox/session.image.card", fields2).title, "photo 001");
});

// ## Image — passes through optional attrs
void test("Image — passes through optional attrs", async (t) => {
  const fields3 = {
    type: "image",
    "has-text": true,
    rotation: "90",
    filename: { ref: "attach/p.jpg", via: { channel: "camera-environment", at: "2024-01-15T00:00:00Z" } },
    description: "Note",
  };
  const s = summaryOf("p.image.card", fields3);
  t.check(s.attrs, {
    "has-text": true,
    rotation: "90",
    filename: "attach/p.jpg",
  });
});

// ## An unparsed card keeps the filename
//
// Without validated fields there is no `title:` to read and no type hook runs, so
// either type falls back to the filename.
void test("Without validated fields there is no title: to read and no type hook runs, so...", async (t) => {
  const doc = summarize({ path: "_content/inbox/Unread_Note.doc.card" }, schemas);
  const image = summarize({ path: "_content/inbox/photo-002.image.card" }, schemas);
  t.check([doc.title, doc.attrs, image.title, image.attrs].join("|"), "Unread Note||photo 002|");
});

// ## Record — name as title, location and quantity as the summary line
//
// An inventory record's summary line says where it is and how many, joined by
// " · ". Either part alone stands alone; with neither, there is no line.
void test("An inventory record's summary line says where it is and how many, joined by \"...", async (t) => {
  const { RecordSchema } = await import("../src/schemas/record.js");

  const records = new Map<string, CardSchema>([["record", RecordSchema]]);
  const record = (fields: Record<string, unknown>) =>
    summarize({ path: "_content/inventory/Solder.record.card", type: "record", fields: { type: "record", name: "Solder", body: "", ...fields } }, records);
  t.check(
    [
      record({ location: { text: "Tray 3" }, quantity: { value: "2 spools" } }),
      record({ location: { text: "Tray 3" } }),
      record({ location: { ref: "../Garage.doc.card" }, quantity: { value: "2 spools" } }),
      record({}),
    ].map((s) => [s.title, s.detail ?? null]),
    [
    [
      "Solder",
      "Tray 3 · 2 spools",
    ],
    [
      "Solder",
      "Tray 3",
    ],
    [
      "Solder",
      "2 spools",
    ],
    [
      "Solder",
      null,
    ],
  ],
  );
});

// ## Person — name as title, where things stand (else role) as the summary line
//
// A person's tile line is where things stand with them (`where-things-stand`); without one
// it falls back to their `role`. A blank one does not hide the role.
void test("A person's summary line is where things stand, else their role", async (t) => {
  const { PersonSchema } = await import("../src/schemas/person.js");

  const people = new Map<string, CardSchema>([["person", PersonSchema]]);
  const person = (fields: Record<string, unknown>) =>
    summarize({ path: "people/Marisol_Vega.person.card", type: "person", fields: { type: "person", name: "Marisol Vega", body: "", ...fields } }, people);
  t.check(
    [
      person({ "where-things-stand": "Replied Oct 20 · you owe her a lunch date", role: "College friend" }),
      person({ "where-things-stand": " ", role: "College friend" }),
      person({}),
    ].map((s) => [s.title, s.detail ?? null]),
    [
      ["Marisol Vega", "Replied Oct 20 · you owe her a lunch date"],
      ["Marisol Vega", "College friend"],
      ["Marisol Vega", null],
    ],
  );
});
