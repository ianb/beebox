# Handle stage

The handle stage looks at each `inbox/triaged/<category>/` bucket,
finds the category's landmark, and invokes its handler procedure with
the bucket of items passed via `TRIAGE_ITEMS`. Tests inject a stubbed
procedure runner so we don't exercise the live procedure engine.

See `docs/triage-design.md` §Handle (stage 3) and `src/core/handle.ts`.

```ts setup
import { runHandle, TRIAGE_ITEMS_ENV } from "../src/core/handle.js";
import { createCollectorContext } from "../src/core/commands/index.js";
import { makeTmpBox } from "./helpers/doctest-helpers.js";
```

## Resolves the procedure ref and passes items via env

```
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
    procedure-ref: archive.procedure.card
---
`,
);
await box.write("box/inbox/triaged/recipes/Bread.memo.card", "<memo>bread</memo>");
await box.write("box/inbox/triaged/recipes/Pasta.memo.card", "<memo>pasta</memo>");

const { ctx } = createCollectorContext(box.root);
const calls = [];
const results = await runHandle({
  ctx,
  options: {
    runProcedure: async ({ procedurePath, triageItems }) => {
      calls.push({ procedurePath, triageItems });
      return { success: true };
    },
  },
});

JSON.stringify(calls, null, 2)
=>
[
  {
    "procedurePath": "store/recipes/archive.procedure.card",
    "triageItems": [
      "box/inbox/triaged/recipes/Bread.memo.card",
      "box/inbox/triaged/recipes/Pasta.memo.card"
    ]
  }
]

JSON.stringify(results.map((r) => ({ category: r.category, outcome: r.outcome })))
=> [{"category":"recipes","outcome":"ran"}]
```

```cleanup
await box.cleanup();
```

## Empty buckets are reported but no procedure runs

```
const box = await makeTmpBox();
await box.write(
  "store/recipes/Recipes.landmark.card",
  `---
navigation:
  label: Recipes
  symbol: 🍳
destinations:
  - for: [triage]
    procedure-ref: archive.procedure.card
---
`,
);
// Create the bucket directory but no items.
await box.write("box/inbox/triaged/recipes/.gitkeep", "");

const { ctx } = createCollectorContext(box.root);
let called = false;
const results = await runHandle({
  ctx,
  options: {
    runProcedure: async () => {
      called = true;
      return { success: true };
    },
  },
});

JSON.stringify({ called, results: results.map((r) => r.outcome) })
=> {"called":false,"results":["no-items"]}
```

```cleanup
await box.cleanup();
```

## Probable-confidence sidecar markers are not passed as items

```
const box = await makeTmpBox();
await box.write(
  "store/recipes/Recipes.landmark.card",
  `---
navigation:
  label: Recipes
  symbol: 🍳
destinations:
  - for: [triage]
    procedure-ref: archive.procedure.card
---
`,
);
await box.write("box/inbox/triaged/recipes/Item.memo.card", "<memo/>");
await box.write("box/inbox/triaged/recipes/Item.memo.card.probable.txt", "Reason: judgment call.");

const { ctx } = createCollectorContext(box.root);
const seen = [];
await runHandle({
  ctx,
  options: {
    runProcedure: async ({ triageItems }) => {
      seen.push(...triageItems);
      return { success: true };
    },
  },
});

JSON.stringify(seen)
=> ["box/inbox/triaged/recipes/Item.memo.card"]
```

```cleanup
await box.cleanup();
```

## Category with no procedure reports `no-procedure`

```
const box = await makeTmpBox();
await box.write(
  "store/notes/Notes.landmark.card",
  `---
navigation:
  label: Notes
  symbol: 📝
destinations:
  - for: [triage]
    rules: Free-form notes.
---
`,
);
await box.write("box/inbox/triaged/notes/Item.memo.card", "<memo/>");

const { ctx } = createCollectorContext(box.root);
const results = await runHandle({
  ctx,
  options: { runProcedure: async () => ({ success: true }) },
});

JSON.stringify(results.map((r) => ({ category: r.category, outcome: r.outcome })))
=> [{"category":"notes","outcome":"no-procedure"}]
```

```cleanup
await box.cleanup();
```

## `_unsure/` is skipped

```
const box = await makeTmpBox();
await box.write("box/inbox/triaged/_unsure/Mystery.memo.card", "<memo/>");

const { ctx } = createCollectorContext(box.root);
let called = false;
const results = await runHandle({
  ctx,
  options: {
    runProcedure: async () => {
      called = true;
      return { success: true };
    },
  },
});

JSON.stringify({ called, buckets: results.length })
=> {"called":false,"buckets":0}
```

```cleanup
await box.cleanup();
```

## Env constant is exported

The procedure engine and any handler procedures look for this exact
name; pin it.

```
TRIAGE_ITEMS_ENV
=> TRIAGE_ITEMS
```
