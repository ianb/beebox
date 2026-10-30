// # View card schema
//
// A `view` card makes an interface surface addressable: its `view` field names
// a builtin view (src/shared/named-views.ts), which the frontend renders in
// place of the card. See docs/plans/interface-as-cards.md ("instrument cards").

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any, str } from "@ianbicking/tap-check/check";
import { parseCardText } from "../src/core/card-io.js";
import { createCardSchemaMap } from "../src/schemas.js";
import { ViewSchema } from "../src/schemas/view.js";
import { errorMessage } from "../src/shared/error-guards.js";

const schemas = await createCardSchemaMap();

// ## A valid view card parses, with title and a notes body
//
// The card is positional-or-nominal like any card; `title` is the label nav
// refs fall back to, and the body is the notes margin for the surface.
void test("The card is positional-or-nominal like any card; title is the label nav refs...", async (t) => {
  const card = parseCardText(`---
title: Chats
view: chat-picker
---
The picker groups by landmark; watch whether the 7-day window feels right.
`, { source: "Chats.view.card", schemas });
  t.check(card.fields, {
    type: "view",
    title: "Chats",
    view: "chat-picker",
    body: "The picker groups by landmark; watch whether the 7-day window feels right.\n",
  });
});

// ## An unknown view name fails with the valid set enumerated
void test("An unknown view name fails with the valid set enumerated", async (t) => {
  const tryParse = (text: string, source: string): string => {
    try { parseCardText(text, { source, schemas }); return "did not throw"; }
    catch (e) { return errorMessage(e); }
  };
  t.check(tryParse("---\nview: dashbord\n---\n", "Oops.view.card"), `Oops.view.card: invalid view frontmatter:
  - view: view must be one of: landmarks, chat-picker, questions, history`);

  // An empty block is a block with no fields (cards/frontmatter.ts fence rule),
  // so the missing `view` field is what fails.
  t.check(tryParse("---\n---\n", "Empty.view.card"), `Empty.view.card: invalid view frontmatter:
  - view: required (expected string)`);
});

// ## `params` configure the view — validated against the view's declared shape
//
// The self-contained `validate` hook (run by `bbx validate`) checks `params`
// against the named view's param schema. A `view: history` card with params
// is a saved filter over the commit timeline.
void test("The self-contained validate hook (run by bbx validate) checks params against...", async (t) => {
  const issues = (fields: Record<string, unknown>) =>
    (ViewSchema.validate?.({ fields }) ?? []).map((i) => i.message);

  t.check(issues({ view: "history", params: { feedback: true, connectors: ["gmail"] } }), []);

  t.check(issues({ view: "history", params: { feedbck: true } }), [
    "params: Unrecognized key: \"feedbck\"",
  ]);

  t.check(issues({ view: "history", params: { feedback: "yes" } }), [
    str`params.feedback: ${any(String)}`,
  ]);

  t.check(issues({ view: "landmarks", params: { anything: 1 } }), [
    "view \"landmarks\" takes no params",
  ]);

  t.check(issues({ view: "landmarks" }), []);
});
