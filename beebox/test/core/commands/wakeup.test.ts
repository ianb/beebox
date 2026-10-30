// # startBbxWakeup: answer once the child holds the cycle lock
//
// The job check must not wait for a whole wakeup, and must not count a run
// that never took the cycle lock. `startBbxWakeup` (`src/core/commands/wakeup.ts`)
// watches the child's output for `[wakeup-cycle] acquired` and answers
// `started` on it; a child that reports `skipped: "wakeup-running"` first
// answers `running`; one that ends any other way first answers `failed`.
// `done` is the whole run either way. See docs/implemented-plans/on-demand-job-triggers.md,
// Track C.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { startBbxWakeup } from "../../../src/core/commands/wakeup.js";
import type { WakeupRunner, WakeupRunResult } from "../../../src/core/wakeup-runner.js";
import type { WakeupOutcomeReport } from "../../../src/cli/wakeup-outcome.js";

const SKIPPED: WakeupOutcomeReport = {
  connectorErrors: 0,
  connectors: [],
  reactorOk: true,
  reactorSkipped: false,
  jobsProcessed: 0,
  jobsRemaining: 0,
  skipped: "wakeup-running",
};

/**
 * A child that prints `chunks` and then ends with `result`, once `release` is
 * called (so a test can see the answer arrive before the run ends).
 */
function fakeChild(chunks: string[], result: WakeupRunResult) {
  const end = Promise.withResolvers<void>();
  const seen: unknown[] = [];
  const run: WakeupRunner = async (opts) => {
    seen.push({ triggeredBy: opts.triggeredBy, maxCycles: opts.maxCycles });
    for (const chunk of chunks) {
      await Promise.resolve();
      opts.onChunk?.(chunk);
    }
    await end.promise;
    return result;
  };
  return { run, seen, release: () => end.resolve() };
}

const OK: WakeupRunResult = { ok: true, detail: "", output: "", outcome: null };

void test("Each way the child can answer", async (t) => {
  // The line can arrive split across chunks. The answer comes before the run
  // ends; `done` is the run's own result.
  const started = fakeChild(["[Processing]\n[wakeup-cy", "cle] acquired\nmore"], OK);
  const answer = await startBbxWakeup({ boxRoot: "/box", triggeredBy: "job-check", maxCycles: 3, run: started.run });
  started.release();
  t.check({ state: answer.state, detail: answer.detail, done: await answer.done, seen: started.seen }, {
    state: "started",
    detail: "",
    done: OK,
    seen: [{ triggeredBy: "job-check", maxCycles: 3 }],
  });

  // Another cycle held the lock: the child said so and ended without the line.
  const busy = fakeChild([], { ok: true, detail: "", output: "", outcome: SKIPPED });
  busy.release();
  const running = await startBbxWakeup({ boxRoot: "/box", triggeredBy: "job-check", run: busy.run });
  t.check({ state: running.state, detail: running.detail }, {
    state: "running",
    detail: "Another wakeup cycle held the lock, so this one did nothing.",
  });

  // It exited before the line (a crash at startup), or the spawn threw.
  const crashed = fakeChild(["boom\n"], { ok: false, detail: "bbx wakeup exited with code 1", output: "boom\n", outcome: null });
  crashed.release();
  const failed = await startBbxWakeup({ boxRoot: "/box", triggeredBy: "job-check", run: crashed.run });
  const threw = await startBbxWakeup({ boxRoot: "/box", triggeredBy: "job-check", run: () => Promise.reject(new Error("spawn EACCES")) });
  t.check([failed.state, failed.detail, threw.state, threw.detail], [
    "failed",
    "bbx wakeup exited with code 1",
    "failed",
    "spawn EACCES",
  ]);
});
