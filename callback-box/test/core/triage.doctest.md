# Triage stage

The triage stage compiles a list of landmark-based categories, asks a
subagent which one each staged item belongs in, and routes the items
into per-category holding spots. The subagent is stubbed below via
`runTriage`'s `decide` option so the tests stay deterministic.

See `docs/triage.md` §Triage (stage 2).

```ts setup
import { compileTriageInstructions } from "../../src/core/triage/instructions.js";
import { runTriage } from "../../src/core/triage/index.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
```

## Compile instructions from landmarks

A landmark with a `triage` destination becomes a category; landmarks
without one are ignored.

```ts
const box = await makeTmpBox();
await box.write(
  "store/recipes/Recipes.landmark.card",
  `---
navigation:
  label: Recipes
  symbol: 🍳
destinations:
  - for: [triage]
    rules: Anything describing how to cook a dish.
    procedure:
      ref: archive-recipe.procedure.card
---
`,
);
await box.write(
  "store/todos/Todos.landmark.card",
  `---
navigation:
  label: Todos
  symbol: ✅
destinations:
  - for: [triage]
    rules: Action items the user has to do.
---
`,
);
await box.write(
  "store/bookmarks/Bookmarks.landmark.card",
  `---
navigation:
  label: Bookmarks
  symbol: 🔖
---
`,
);

const { categories } = await compileTriageInstructions(box.root);
JSON.stringify(categories.map((c) => ({ name: c.name, dir: c.dir, rules: c.rules })), null, 2)
=>
[
  {
    "name": "recipes",
    "dir": "store/recipes",
    "rules": "Anything describing how to cook a dish."
  },
  {
    "name": "todos",
    "dir": "store/todos",
    "rules": "Action items the user has to do."
  }
]
```

```ts cleanup
await box.cleanup();
```

## Route confident decisions

The triage agent's decisions are applied verbatim for `confident` and
`probable`. The file moves from `inbox/staged/` to
`inbox/triaged/<category>/`.

```ts
const box = await makeTmpBox();
await box.write(
  "store/recipes/Recipes.landmark.card",
  `---
navigation:
  label: Recipes
  symbol: 🍳
destinations:
  - for: [triage]
    rules: Cooking instructions.
---
`,
);
await box.write("box/inbox/staged/Bread.memo.card", "<memo>flour, water, salt</memo>");

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

JSON.stringify(result.applications, null, 2)
=>
[
  {
    "file": "Bread.memo.card",
    "outcome": "routed",
    "destination": "box/inbox/triaged/recipes"
  }
]

await box.read("box/inbox/triaged/recipes/Bread.memo.card")
=> <memo>flour, water, salt</memo>
```

```ts cleanup
await box.cleanup();
```

## Probable decisions drop a review marker

```ts
const box = await makeTmpBox();
await box.write(
  "store/recipes/Recipes.landmark.card",
  `---
navigation:
  label: Recipes
  symbol: 🍳
destinations:
  - for: [triage]
    rules: Cooking instructions.
---
`,
);
await box.write("box/inbox/staged/Maybe.memo.card", "<memo>could be a recipe</memo>");

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

await box.read("box/inbox/triaged/recipes/Maybe.memo.card.probable.txt")
=>
Triage confidence: probable
Reason: Vague ingredient mention.
```

```ts cleanup
await box.cleanup();
```

## Guess decisions are held and trigger a question

A `guess`-level decision moves the file into `_unsure/` and writes a
question card naming the candidate categories.

```ts
const box = await makeTmpBox();
await box.write(
  "store/recipes/Recipes.landmark.card",
  `---
navigation:
  label: Recipes
  symbol: 🍳
destinations:
  - for: [triage]
    rules: Cooking instructions.
---
`,
);
await box.write(
  "store/todos/Todos.landmark.card",
  `---
navigation:
  label: Todos
  symbol: ✅
destinations:
  - for: [triage]
    rules: Action items.
---
`,
);
await box.write("box/inbox/staged/Mystery.memo.card", "<memo>ambiguous</memo>");

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

JSON.stringify(result.applications.map((a) => ({
  file: a.file,
  outcome: a.outcome,
  destination: a.destination,
  hasQuestion: typeof a.questionPath === "string",
})), null, 2)
=>
[
  {
    "file": "Mystery.memo.card",
    "outcome": "held",
    "destination": "box/inbox/triaged/_unsure",
    "hasQuestion": true
  }
]

const yaml = await box.read(result.applications[0].questionPath);
yaml.includes("id: recipes")
=> true

yaml.includes("id: todos")
=> true

yaml.includes("id: _other")
=> true
```

```ts cleanup
await box.cleanup();
```

## Empty staged is a no-op

```ts
const box = await makeTmpBox();
const result = await runTriage({ boxRoot: box.root, decide: async () => ({ decisions: [] }) });
JSON.stringify({ empty: result.empty, decisions: result.decisions.length })
=> {"empty":true,"decisions":0}
```

```ts cleanup
await box.cleanup();
```
