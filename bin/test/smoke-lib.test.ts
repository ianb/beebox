// # Smoke step times
//
// When the smoke walk runs out of its budget, the reader has to tell host load
// from a broken step. Load makes every step slower than usual; a broken step is
// slow alone. So each step's line in the walk's output gives its own time and,
// once the run log holds enough history, its usual (median) time.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { formatStepTime, walkSlowdown } from "../smoke-lib.js";
import { BUDGET_MS, Budget, MAX_SLOWDOWN } from "../smoke-harness.js";

/** A step's history as `--report` folds it from the run log. */
const history = (ran: number, medianSeconds: number) =>
  ({ id: "card-open", ran, failed: 0, injected: 0, medianSeconds, lastFailure: null });

// With five or more logged runs, the usual time follows the step's own.
void test("With five or more logged runs, the usual time follows the step's own.", async (t) => {
  t.check(formatStepTime(41_234, history(30, 3.1)), "41.2s; usual 3.1s");
});

// With fewer runs, a median is noise, so only the step's own time is shown. A
// step that has never run has no history at all.
void test("With fewer runs, a median is noise, so only the step's own time is shown.", async (t) => {
  t.check([formatStepTime(2_000, history(4, 3.1)), formatStepTime(2_000, undefined)], [
    "2.0s",
    "2.0s",
  ]);
});

// ## Walk slowdown
//
// The walk's budget grows by how much slower than usual its finished steps ran
// together. A step without enough history counts for nothing, and a failed or
// unreached step is not a finished one.
void test("The slowdown is finished steps' total time over their usual total.", async (t) => {
  const usual = new Map([
    ["cold-start", { ...history(30, 10), id: "cold-start" }],
    ["chat-shell", { ...history(30, 5), id: "chat-shell" }],
    ["new-step", { ...history(2, 1), id: "new-step" }],
  ]);
  t.check(
    [
      walkSlowdown(
        [
          { id: "cold-start", outcome: "ok", ms: 30_000 },
          { id: "chat-shell", outcome: "ok", ms: 15_000 },
          { id: "new-step", outcome: "ok", ms: 60_000 },
          { id: "place-menu", outcome: "fail", ms: 90_000 },
        ],
        usual,
      ),
      walkSlowdown([{ id: "new-step", outcome: "ok", ms: 60_000 }], usual),
      walkSlowdown([], usual),
    ],
    [3, 1, 1],
  );
});

// The budget follows the slowdown up to a ceiling, and never shrinks: a fast
// step after slow ones must not end the walk at a deadline already passed.
void test("The budget grows with the slowdown, capped, and never shrinks.", async (t) => {
  const budget = new Budget(BUDGET_MS);
  const totals: number[] = [budget.totalMs()];
  for (const slowdown of [0.5, 2, 1.2, 10]) {
    budget.scaleTo(slowdown);
    totals.push(budget.totalMs());
  }
  t.check(totals, [BUDGET_MS, BUDGET_MS, BUDGET_MS * 2, BUDGET_MS * 2, BUDGET_MS * MAX_SLOWDOWN]);
});
