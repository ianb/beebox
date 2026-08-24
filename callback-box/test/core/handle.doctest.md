# Handle stage

The handle stage looks at each `inbox/triaged/<category>/` bucket,
finds the category's landmark, and invokes its handler procedure with
the bucket of items passed via `TRIAGE_ITEMS`. Tests inject a stubbed
procedure runner so we don't exercise the live procedure engine.

See `docs/triage.md` §Handle (stage 3) and `src/core/handle.ts`.

```ts setup
import {
  runHandle,
  formatHandlingLines,
  handleVerdict,
  describeHandleFailures,
  readHandlingResults,
  TRIAGE_ITEMS_ENV,
} from "../../src/core/handle.js";
import { formatHandleInconclusiveLine } from "../../src/shared/inconclusive.js";
import { createCollectorContext } from "../../src/core/commands/index.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
```

## Resolves the procedure ref and passes items via env

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
    procedure:
      ref: archive.procedure.card
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
      return { outcome: "completed" };
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

```ts cleanup
await box.cleanup();
```

## A box-path procedure ref resolves from the box root

`procedure.ref` is a box path (leading `/`) like every other ref; the bare
form above still resolves against the landmark's own directory.

```ts
const box = await makeTmpBox();
await box.write(
  "store/recipes/Recipes.landmark.card",
  `---
navigation:
  label: Recipes
destinations:
  - for: [triage]
    rules: Cooking instructions.
    procedure:
      ref: /config/procedures/archive.procedure.card
---
`,
);
await box.write("box/inbox/triaged/recipes/Bread.memo.card", "<memo>bread</memo>");

const { ctx } = createCollectorContext(box.root);
const calls = [];
await runHandle({
  ctx,
  options: {
    runProcedure: async ({ procedurePath }) => {
      calls.push(procedurePath);
      return { outcome: "completed" };
    },
  },
});

JSON.stringify(calls)
=> ["config/procedures/archive.procedure.card"]
```

```ts cleanup
await box.cleanup();
```

## Empty buckets are reported but no procedure runs

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
    procedure:
      ref: archive.procedure.card
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
      return { outcome: "completed" };
    },
  },
});

JSON.stringify({ called, results: results.map((r) => r.outcome) })
=> {"called":false,"results":["no-items"]}
```

```ts cleanup
await box.cleanup();
```

## Probable-confidence sidecar markers are not passed as items

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
    procedure:
      ref: archive.procedure.card
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
      return { outcome: "completed" };
    },
  },
});

JSON.stringify(seen)
=> ["box/inbox/triaged/recipes/Item.memo.card"]
```

```ts cleanup
await box.cleanup();
```

## Category with no procedure reports `no-procedure`

```ts
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
  options: { runProcedure: async () => ({ outcome: "completed" }) },
});

JSON.stringify(results.map((r) => ({ category: r.category, outcome: r.outcome })))
=> [{"category":"notes","outcome":"no-procedure"}]
```

```ts cleanup
await box.cleanup();
```

## `_unsure/` is skipped

```ts
const box = await makeTmpBox();
await box.write("box/inbox/triaged/_unsure/Mystery.memo.card", "<memo/>");

const { ctx } = createCollectorContext(box.root);
let called = false;
const results = await runHandle({
  ctx,
  options: {
    runProcedure: async () => {
      called = true;
      return { outcome: "completed" };
    },
  },
});

JSON.stringify({ called, buckets: results.length })
=> {"called":false,"buckets":0}
```

```ts cleanup
await box.cleanup();
```

## An inconclusive handler run is reported as inconclusive, not as done

A handler whose work completed but whose review reached no verdict is neither
`ran` nor `procedure-failed`. The bucket outcome says so, and the report line
names the reason and says the work itself completed — the misreading this
distinction exists to prevent.

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
    procedure:
      ref: archive.procedure.card
---
`,
);
await box.write("box/inbox/triaged/recipes/Bread.memo.card", "<memo/>");

const { ctx } = createCollectorContext(box.root);
const results = await runHandle({
  ctx,
  options: {
    runProcedure: async () => ({
      outcome: "inconclusive",
      detail: "review of step archive reached max turns (8)",
    }),
  },
});

JSON.stringify(results.map((r) => ({ outcome: r.outcome, detail: r.detail })), null, 2)
=>
[
  {
    "outcome": "procedure-inconclusive",
    "detail": "review of step archive reached max turns (8)"
  }
]
```

The report line a reader sees:

```ts continue
JSON.stringify(formatHandlingLines(results[0]), null, 2)
=>
[
  "  procedure-inconclusive\trecipes (1 item) [store/recipes/archive.procedure.card]",
  "    └─ inconclusive — review of step archive reached max turns (8); work completed"
]
```

```ts cleanup
await box.cleanup();
```

## A failed handler run still reports its error

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
    procedure:
      ref: archive.procedure.card
---
`,
);
await box.write("box/inbox/triaged/recipes/Bread.memo.card", "<memo/>");

const { ctx } = createCollectorContext(box.root);
const results = await runHandle({
  ctx,
  options: {
    runProcedure: async () => ({ outcome: "failed", detail: "step archive failed" }),
  },
});

JSON.stringify(formatHandlingLines(results[0]), null, 2)
=>
[
  "  procedure-failed\trecipes (1 item) [store/recipes/archive.procedure.card]",
  "    └─ step archive failed"
]
```

```ts cleanup
await box.cleanup();
```

## The pass exits for its worst bucket

`cb handle` used to exit 0 whether a handler failed, reached no verdict, or
did neither — a wakeup script gating on it saw a green run in all three cases.
The verdict is the worst outcome present, in that order.

```ts
const bucket = (category, outcome, detail) => ({ category, items: ["x"], outcome, ...(detail && { detail }) });
const clean = [bucket("recipes", "ran"), bucket("receipts", "no-items")];
const unjudged = [bucket("recipes", "ran"), bucket("receipts", "procedure-inconclusive", "review of step file reached max turns (8)")];
const broken = [...unjudged, bucket("notes", "procedure-failed", "step archive failed")];
print(`${handleVerdict(clean)}, ${handleVerdict(unjudged)}, ${handleVerdict(broken)}`);
print(describeHandleFailures(broken));
=>
ok, inconclusive, failed
handler procedure failed for notes (step archive failed)
```

The stderr line an unjudged bucket prints is the scheduler's vocabulary, same
prefix and closing clause as a procedure run's:

```ts continue
print(formatHandleInconclusiveLine({ category: "receipts", detail: unjudged[1].detail }));
=> Inconclusive: handle receipts — review of step file reached max turns (8); work completed
```

The CLI reads the results back across the untyped command boundary, so a
mis-shaped value can't become a silent clean exit — unknown outcomes are
dropped rather than trusted:

```ts continue
JSON.stringify(readHandlingResults([...unjudged, { category: "junk", outcome: "who-knows" }, "nope"]).map((r) => r.outcome))
=> ["ran","procedure-inconclusive"]
```

## Env constant is exported

The procedure engine and any handler procedures look for this exact
name; pin it.

```ts
TRIAGE_ITEMS_ENV
=> TRIAGE_ITEMS
```
