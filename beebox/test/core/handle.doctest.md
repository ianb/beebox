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
} from "../../src/core/handle.js";
import { formatHandleInconclusiveLine } from "../../src/shared/inconclusive.js";
import { createCollectorContext } from "../../src/core/command-runner.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";

// A landmark card for `_content/<dir>/` whose triage destination has the given
// extra YAML lines (a `procedure:` block, or nothing).
function landmark(label: string, destination: string): string {
  return `---
navigation:
  label: ${label}
destinations:
  - for: [triage]
    rules: Sorted by hand.
${destination}---
`;
}
const procedureRef = (ref: string) => `    procedure:\n      ref: ${ref}\n`;

// Run the pass with a procedure runner that records each call.
async function handle(box, outcome = { outcome: "completed" }) {
  const { ctx } = createCollectorContext(box.root);
  const calls: { procedurePath: string; triageItems: string[] }[] = [];
  const results = await runHandle({
    ctx,
    options: { runProcedure: async ({ procedurePath, triageItems }) => { calls.push({ procedurePath, triageItems }); return outcome; } },
  });
  return { calls, results };
}

// A box with one recipes bucket holding one item, handled with `outcome`.
async function recipesBox() {
  const box = await makeTmpBox();
  await box.write("_content/recipes/Recipes.landmark.card", landmark("Recipes", procedureRef("archive.procedure.card")));
  await box.write("_content/inbox/triaged/recipes/Bread.memo.card", "<memo/>");
  return box;
}
```

## Resolves the procedure ref and passes items via env

A bare `procedure.ref` resolves against the landmark's own directory; a
box-path ref (leading `/`, like every other ref) resolves from the box root.
Each bucket's items are passed to its procedure. A `.probable.txt` sidecar
marker beside an item is not an item.

```ts
const box = await makeTmpBox();
await box.write("_content/recipes/Recipes.landmark.card", landmark("Recipes", procedureRef("archive.procedure.card")));
await box.write("_content/receipts/Receipts.landmark.card", landmark("Receipts", procedureRef("/_config/procedures/archive.procedure.card")));
await box.write("_content/inbox/triaged/recipes/Bread.memo.card", "<memo>bread</memo>");
await box.write("_content/inbox/triaged/recipes/Pasta.memo.card", "<memo>pasta</memo>");
await box.write("_content/inbox/triaged/recipes/Pasta.memo.card.probable.txt", "Reason: judgment call.");
await box.write("_content/inbox/triaged/receipts/Lunch.memo.card", "<memo>lunch</memo>");

const { calls, results } = await handle(box);
({ calls, buckets: results.map((r) => ({ category: r.category, outcome: r.outcome })) })
=>
{
  calls: [
    {
      procedurePath: "_config/procedures/archive.procedure.card",
      triageItems: ["_content/inbox/triaged/receipts/Lunch.memo.card"]
    },
    {
      procedurePath: "_content/recipes/archive.procedure.card",
      triageItems: [
        "_content/inbox/triaged/recipes/Bread.memo.card",
        "_content/inbox/triaged/recipes/Pasta.memo.card"
      ]
    }
  ],
  buckets: [{ category: "receipts", outcome: "ran" }, { category: "recipes", outcome: "ran" }]
}
```

```ts cleanup
await box.cleanup();
```

## Buckets that run no procedure

An empty bucket is reported as `no-items`, a category whose landmark names no
procedure as `no-procedure`, and `_unsure/` is skipped outright (no result at
all). No runner is called for any of them:

```ts
const box = await makeTmpBox();
await box.write("_content/recipes/Recipes.landmark.card", landmark("Recipes", procedureRef("archive.procedure.card")));
await box.write("_content/inbox/triaged/recipes/.gitkeep", ""); // bucket directory, no items
await box.write("_content/notes/Notes.landmark.card", landmark("Notes", ""));
await box.write("_content/inbox/triaged/notes/Item.memo.card", "<memo/>");
await box.write("_content/inbox/triaged/_unsure/Mystery.memo.card", "<memo/>");

const { calls, results } = await handle(box);
({ calls, buckets: results.map((r) => ({ category: r.category, outcome: r.outcome })) })
=>
{ calls: [], buckets: [{ category: "notes", outcome: "no-procedure" }, { category: "recipes", outcome: "no-items" }] }
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
const box = await recipesBox();
const { results } = await handle(box, { outcome: "inconclusive", detail: "review of step archive reached max turns (8)" });
({ buckets: results.map((r) => ({ outcome: r.outcome, detail: r.detail })), report: formatHandlingLines(results[0]) })
=>
{
  buckets: [{ outcome: "procedure-inconclusive", detail: "review of step archive reached max turns (8)" }],
  report: [
    "  procedure-inconclusive\trecipes (1 item) [_content/recipes/archive.procedure.card]",
    "    └─ inconclusive — review of step archive reached max turns (8); work completed"
  ]
}
```

A failed handler run still reports its error:

```ts continue
const failed = await handle(box, { outcome: "failed", detail: "step archive failed" });
formatHandlingLines(failed.results[0])
=>
[
  "  procedure-failed\trecipes (1 item) [_content/recipes/archive.procedure.card]",
  "    └─ step archive failed"
]
```

```ts cleanup
await box.cleanup();
```

## The pass exits for its worst bucket

`bbx handle` used to exit 0 whether a handler failed, reached no verdict, or
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
