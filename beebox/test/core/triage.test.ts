// # Triage stage
//
// The triage stage compiles a list of landmark-based categories, asks a
// subagent which one each staged item belongs in, and routes the items
// into per-category holding spots. The subagent is stubbed below via
// `runTriage`'s `decide` option so the tests stay deterministic.
//
// See `docs/triage.md` §Triage (stage 2).

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { isoDate, str } from "@ianbicking/tap-check/check";
import { compileTriageInstructions } from "../../src/core/triage/instructions.js";
import { runTriage } from "../../src/core/triage/run/core.js";
import { makeTmpBox } from "../helpers/test-helpers.js";

// ## Compile instructions from landmarks
//
// A landmark with a `triage` destination becomes a category; landmarks
// without one are ignored.
void test("A landmark with a triage destination becomes a category; landmarks without on...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  await box.write(
    "_content/recipes/Recipes.landmark.card",
    `---
symbol:
  glyph: 🍳
navigation:
  label: Recipes
destinations:
  - for: [triage]
    rules: Anything describing how to cook a dish.
    procedure:
      ref: archive-recipe.procedure.card
---
`,
  );
  await box.write(
    "_content/todos/Todos.landmark.card",
    `---
symbol:
  glyph: ✅
navigation:
  label: Todos
destinations:
  - for: [triage]
    rules: Action items the user has to do.
---
`,
  );
  await box.write(
    "store/bookmarks/Bookmarks.landmark.card",
    `---
symbol:
  glyph: 🔖
navigation:
  label: Bookmarks
---
`,
  );

  const { categories } = await compileTriageInstructions(box.root);
  t.check(categories.map((c) => ({ name: c.name, dir: c.dir, rules: c.rules })), [
    {
      name: "recipes",
      dir: "_content/recipes",
      rules: "Anything describing how to cook a dish.",
    },
    {
      name: "todos",
      dir: "_content/todos",
      rules: "Action items the user has to do.",
    },
  ]);
});

// ## Route confident decisions
//
// The triage agent's decisions are applied verbatim for `confident` and
// `probable`. The file moves from `inbox/staged/` to
// `inbox/triaged/<category>/`.
void test("The triage agent's decisions are applied verbatim for confident and probable.", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  await box.write(
    "_content/recipes/Recipes.landmark.card",
    `---
symbol:
  glyph: 🍳
navigation:
  label: Recipes
destinations:
  - for: [triage]
    rules: Cooking instructions.
---
`,
  );
  await box.write("_content/inbox/staged/Bread.doc.card", "<doc>flour, water, salt</doc>");

  const result = await runTriage({
    boxRoot: box.root,
    decide: async (items) => ({
      decisions: items.map((item) => ({
        file: item.file,
        category: "recipes",
        confidence: "confident",
        reason: "Mentions ingredients.",
      })),
    }),
  });

  t.check(result.applications, [
    {
      file: "Bread.doc.card",
      outcome: "routed",
      destination: "_content/inbox/triaged/recipes",
    },
  ]);

  t.check(await box.read("_content/inbox/triaged/recipes/Bread.doc.card"), "<doc>flour, water, salt</doc>");
});

// ## Probable decisions drop a review marker
void test("Probable decisions drop a review marker", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  await box.write(
    "_content/recipes/Recipes.landmark.card",
    `---
symbol:
  glyph: 🍳
navigation:
  label: Recipes
destinations:
  - for: [triage]
    rules: Cooking instructions.
---
`,
  );
  await box.write("_content/inbox/staged/Maybe.doc.card", "<doc>could be a recipe</doc>");

  await runTriage({
    boxRoot: box.root,
    decide: async (items) => ({
      decisions: items.map((item) => ({
        file: item.file,
        category: "recipes",
        confidence: "probable",
        reason: "Vague ingredient mention.",
      })),
    }),
  });

  await t.checkText(await box.read("_content/inbox/triaged/recipes/Maybe.doc.card.probable.txt"), `Triage confidence: probable
Reason: Vague ingredient mention.`);
});

// ## Guess decisions are held and trigger a question
//
// A `guess`-level decision moves the file into `_unsure/` and writes a
// question card naming the candidate categories.
void test("A guess-level decision moves the file into unsure/ and writes a question card...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  await box.write(
    "_content/recipes/Recipes.landmark.card",
    `---
symbol:
  glyph: 🍳
navigation:
  label: Recipes
destinations:
  - for: [triage]
    rules: Cooking instructions.
---
`,
  );
  await box.write(
    "_content/todos/Todos.landmark.card",
    `---
symbol:
  glyph: ✅
navigation:
  label: Todos
destinations:
  - for: [triage]
    rules: Action items.
---
`,
  );
  await box.write("_content/inbox/staged/Mystery.doc.card", "<doc>ambiguous</doc>");

  const result = await runTriage({
    boxRoot: box.root,
    decide: async (items) => ({
      decisions: items.map((item) => ({
        file: item.file,
        category: null,
        confidence: "guess",
        reason: "Could be either.",
      })),
    }),
  });

  t.check(
    result.applications.map((a) => ({
      file: a.file,
      outcome: a.outcome,
      destination: a.destination,
      hasQuestion: typeof a.questionPath === "string",
    })),
    [
    {
      file: "Mystery.doc.card",
      outcome: "held",
      destination: "_content/inbox/triaged/_unsure",
      hasQuestion: true,
    },
  ],
  );

  const yaml = await box.read(result.applications[0]?.questionPath ?? "");
  t.check(
    yaml,
    str`---
title: Where Mystery.doc.card goes
memo: |-
  The triage agent wasn't sure where this item belongs.

  Agent reasoning: Could be either.

  Held at: _content/inbox/triaged/_unsure/Mystery.doc.card
prompt: Which category does Mystery.doc.card belong in?
input:
  type: select
  options:
    - id: recipes
      label: recipes
    - id: todos
      label: todos
    - id: _other
      label: None of these — write a directive
learning:
  sink: guide
  proposal: Items like "Mystery.doc.card" (Could be either.) belong in whichever category the boxholder picks — record that placement as a triage rule so similar items route without asking again.
directive: Move _content/inbox/triaged/_unsure/Mystery.doc.card from inbox/triaged/_unsure/ into inbox/triaged/<chosen-category>/. If "_other" was selected, follow the user's free-text directive instead.
asked-at: ${isoDate()}
---
`,
  );
});

// ## Empty staged is a no-op
void test("Empty staged is a no-op", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  const result = await runTriage({ boxRoot: box.root, decide: async () => ({ decisions: [] }) });
  t.check({ empty: result.empty, decisions: result.decisions }, {
    empty: true,
    decisions: [],
  });
});
