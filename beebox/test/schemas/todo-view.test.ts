// # `todo-view` card schema
//
// Frontmatter-only schema for the `todo-view` card
// (`docs/plans/todo-collection.md` Track 4): `glob`/`todo-status`/`assigned` are the
// query, no body. `glob` has NO schema default (pinned mechanism detail — see
// `src/schemas/todo-view.ts`'s module doc) — an omitted `glob` follows from the
// query's `here`, which the renderer sets to the card's own directory, not from
// this schema.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { containing } from "@ianbicking/tap-check/check";
import { TodoViewSchema, createTodoViewTemplate } from "../../src/schemas/todo-view.js";
import { getCardTypes } from "../../src/schemas.js";
import { getDefaultTemplate } from "../../src/templates-registry.js";
import { parseCardText } from "../../src/core/card-io.js";
import { createCardSchemaMap } from "../../src/schemas.js";

const schemas = await createCardSchemaMap();

// ## Registered as `todo-view`, in the schema registry, with a default template
void test("Registered as `todo-view`, in the schema registry, with a default template", async (t) => {
  t.check(getCardTypes(), containing(["todo-view"]));

  t.check(getDefaultTemplate("todo-view")?.name, "todo-view");
});

// ## A bare card (no fields at all) loads fine — `glob` has no default
void test("A bare card (no fields at all) loads fine — `glob` has no default", async (t) => {
  const bare = "---\n{}\n---\n";
  const parsed = parseCardText(bare, { source: "_content/plate.todo-view.card", schemas, type: "todo-view" });
  t.check(parsed.fields, { type: "todo-view" });
});

// ## `glob`/`todo-status`/`assigned` all load when present
void test("`glob`/`todo-status`/`assigned` all load when present", async (t) => {
  const full = "---\nglob: \"_content/projects/kitchen/**\"\ntodo-status:\n  - open\n  - parked\nassigned: agent\n---\n";
  const parsedFull = parseCardText(full, { source: "_content/kitchen/plate.todo-view.card", schemas, type: "todo-view" });
  t.check(parsedFull.fields, {
    type: "todo-view",
    glob: "_content/projects/kitchen/**",
    "todo-status": ["open", "parked"],
    assigned: "agent",
  });
});

// ## An out-of-enum `todo-status` value is rejected
void test("An out-of-enum `todo-status` value is rejected", async (t) => {
  t.check(TodoViewSchema.frontmatterSchema.safeParse({ type: "todo-view", "todo-status": ["not-a-status"] }).success, false);
});

// ## Template generation: omitted `glob` (subtree default) vs. explicit `glob: "**"` (the stock box-wide instance)
void test("Template generation: omitted `glob` (subtree default) vs. explicit `glob: \"**\"` (the stock box-wide instance)", async (t) => {
  const subtree = createTodoViewTemplate({ title: "Kitchen Remodel" });
  t.check(subtree, "---\ntitle: Kitchen Remodel\n---\n");
  const boxWide = createTodoViewTemplate({ glob: "**", title: "The Plate" });
  t.check(boxWide, "---\ntitle: The Plate\nglob: \"**\"\n---\n");

  // A card generated from the box-wide template round-trips through
  // `parseCardText`:

  const parsedBoxWide = parseCardText(boxWide, { source: "_content/plate.todo-view.card", schemas, type: "todo-view" });
  t.check(parsedBoxWide.fields, { type: "todo-view", glob: "**", title: "The Plate" });
});
