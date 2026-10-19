// # Handle stage
//
// The handle stage looks at each `inbox/triaged/<category>/` bucket,
// finds the category's landmark, and invokes its handler procedure with
// the bucket of items passed via `TRIAGE_ITEMS`. Tests inject a stubbed
// procedure runner so we don't exercise the live procedure engine.
//
// See `docs/triage.md` §Handle (stage 3) and `src/core/handle.ts`.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import {
  runHandle,
  formatHandlingLines,
  handleVerdict,
  describeHandleFailures,
  readHandlingResults,
  type CategoryHandling,
  type RunProcedureOutput,
} from "../../src/core/handle.js";
import { formatHandleInconclusiveLine } from "../../src/shared/inconclusive.js";
import { createCollectorContext } from "../../src/core/command-runner.js";
import { makeTmpBox, type TmpBox } from "../helpers/test-helpers.js";

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
async function handle(box: TmpBox, outcome?: RunProcedureOutput) {
  const { ctx } = createCollectorContext(box.root);
  const calls: { procedurePath: string; triageItems: string[] }[] = [];
  const runOutcome: RunProcedureOutput = outcome ?? { outcome: "completed" };
  const results = await runHandle({
    ctx,
    options: { runProcedure: async ({ procedurePath, triageItems }) => { calls.push({ procedurePath, triageItems }); return runOutcome; } },
  });
  return { calls, results };
}

// A box with one recipes bucket holding one item, handled with `outcome`.
async function recipesBox() {
  const box = await makeTmpBox();
  await box.write("_content/recipes/Recipes.landmark.card", landmark("Recipes", procedureRef("archive.procedure.card")));
  await box.write("_content/inbox/triaged/recipes/Bread.doc.card", "<doc/>");
  return box;
}

// ## Resolves the procedure ref and passes items via env
//
// A bare `procedure.ref` resolves against the landmark's own directory; a
// box-path ref (leading `/`, like every other ref) resolves from the box root.
// Each bucket's items are passed to its procedure. A `.probable.txt` sidecar
// marker beside an item is not an item.
void test("A bare procedure.ref resolves against the landmark's own directory; a box-pat...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  await box.write("_content/recipes/Recipes.landmark.card", landmark("Recipes", procedureRef("archive.procedure.card")));
  await box.write("_content/receipts/Receipts.landmark.card", landmark("Receipts", procedureRef("/_config/procedures/archive.procedure.card")));
  await box.write("_content/inbox/triaged/recipes/Bread.doc.card", "<doc>bread</doc>");
  await box.write("_content/inbox/triaged/recipes/Pasta.doc.card", "<doc>pasta</doc>");
  await box.write("_content/inbox/triaged/recipes/Pasta.doc.card.probable.txt", "Reason: judgment call.");
  await box.write("_content/inbox/triaged/receipts/Lunch.doc.card", "<doc>lunch</doc>");

  const { calls, results } = await handle(box);
  t.check({ calls, results }, {
    calls: [
      {
        procedurePath: "_config/procedures/archive.procedure.card",
        triageItems: [
          "_content/inbox/triaged/receipts/Lunch.doc.card",
        ],
      },
      {
        procedurePath: "_content/recipes/archive.procedure.card",
        triageItems: [
          "_content/inbox/triaged/recipes/Bread.doc.card",
          "_content/inbox/triaged/recipes/Pasta.doc.card",
        ],
      },
    ],
    results: [
      {
        category: "receipts",
        items: ["Lunch.doc.card"],
        outcome: "ran",
        procedurePath: "_config/procedures/archive.procedure.card",
      },
      {
        category: "recipes",
        items: ["Bread.doc.card", "Pasta.doc.card"],
        outcome: "ran",
        procedurePath: "_content/recipes/archive.procedure.card",
      },
    ],
  });
});

// ## Buckets that run no procedure
//
// An empty bucket is reported as `no-items`, a category whose landmark names no
// procedure as `no-procedure`, and `_unsure/` is skipped outright (no result at
// all). No runner is called for any of them:
void test("An empty bucket is reported as no-items, a category whose landmark names no p...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  await box.write("_content/recipes/Recipes.landmark.card", landmark("Recipes", procedureRef("archive.procedure.card")));
  await box.write("_content/inbox/triaged/recipes/.gitkeep", ""); // bucket directory, no items
  await box.write("_content/notes/Notes.landmark.card", landmark("Notes", ""));
  await box.write("_content/inbox/triaged/notes/Item.doc.card", "<doc/>");
  await box.write("_content/inbox/triaged/_unsure/Mystery.doc.card", "<doc/>");

  const { calls, results } = await handle(box);
  t.check({ calls, results }, {
    calls: [],
    results: [
      { category: "notes", items: ["Item.doc.card"], outcome: "no-procedure" },
      { category: "recipes", items: [], outcome: "no-items" },
    ],
  });
});

// ## An inconclusive handler run is reported as inconclusive, not as done
//
// A handler whose work completed but whose review reached no verdict is neither
// `ran` nor `procedure-failed`. The bucket outcome says so, and the report line
// names the reason and says the work itself completed — the misreading this
// distinction exists to prevent.
void test("A handler whose work completed but whose review reached no verdict is neither...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await recipesBox();
  const { results } = await handle(box, { outcome: "inconclusive", detail: "review of step archive reached max turns (8)" });
  t.check({ results, report: results.flatMap(formatHandlingLines) }, {
    results: [
      {
        category: "recipes",
        items: ["Bread.doc.card"],
        outcome: "procedure-inconclusive",
        procedurePath: "_content/recipes/archive.procedure.card",
        detail: "review of step archive reached max turns (8)",
      },
    ],
    report: [
      "  procedure-inconclusive\trecipes (1 item) [_content/recipes/archive.procedure.card]",
      "    └─ inconclusive — review of step archive reached max turns (8); work completed",
    ],
  });

  // A failed handler run still reports its error:

  const failed = await handle(box, { outcome: "failed", detail: "step archive failed" });
  t.check(failed.results.flatMap(formatHandlingLines), [
    "  procedure-failed\trecipes (1 item) [_content/recipes/archive.procedure.card]",
    "    └─ step archive failed",
  ]);
});

// ## The pass exits for its worst bucket
//
// `bbx handle` used to exit 0 whether a handler failed, reached no verdict, or
// did neither — a wakeup script gating on it saw a green run in all three cases.
// The verdict is the worst outcome present, in that order.
void test("bbx handle used to exit 0 whether a handler failed, reached no verdict, or di...", async (t) => {
  const bucket = (category: string, outcome: CategoryHandling["outcome"]): CategoryHandling => ({ category, items: ["x"], outcome });
  const clean = [bucket("recipes", "ran"), bucket("receipts", "no-items")];
  const unjudged = [bucket("recipes", "ran"), { ...bucket("receipts", "procedure-inconclusive"), detail: "review of step file reached max turns (8)" }];
  const broken = [...unjudged, { ...bucket("notes", "procedure-failed"), detail: "step archive failed" }];
  t.check([handleVerdict(clean), handleVerdict(unjudged), handleVerdict(broken)], ["ok", "inconclusive", "failed"]);
  t.check(describeHandleFailures(broken), "handler procedure failed for notes (step archive failed)");

  // The stderr line an unjudged bucket prints is the scheduler's vocabulary, same
  // prefix and closing clause as a procedure run's:

  t.check(formatHandleInconclusiveLine({ category: "receipts", detail: unjudged[1]?.detail ?? "" }), "Inconclusive: handle receipts — review of step file reached max turns (8); work completed");

  // The CLI reads the results back across the untyped command boundary, so a
  // mis-shaped value can't become a silent clean exit — unknown outcomes are
  // dropped rather than trusted:

  t.check(readHandlingResults([...unjudged, { category: "junk", outcome: "who-knows" }, "nope"]), unjudged);
});
