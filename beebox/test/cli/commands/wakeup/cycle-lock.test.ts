// # One wakeup cycle per box at a time
//
// Only the reactor step used to be serialized (`core/reactor/engine.ts`), so `bbx
// tick`, the Sync button, and a scheduled `bbx wakeup` could interleave
// preprocessing, connectors and push — two processes staging the same tree and
// each seeing half of the other's work. `runUnderWakeupCycleLock` puts the whole
// cycle behind one per-box lock (`lib/file-lock.ts`, never `proper-lockfile`
// directly).
//
// A contended cycle does no work at all. It does not queue behind the first one:
// a cycle that waited would then run against a box the first cycle had just
// rewritten, which is the same interleaving one step later.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import {
  runUnderWakeupCycleLock,
  wakeupCycleLockPath,
  WAKEUP_ALREADY_RUNNING,
} from "../../../../src/cli/commands/wakeup/cycle-lock.js";
import { parseWakeupOutcome, WAKEUP_CYCLE_ACQUIRED, WAKEUP_OUTCOME_ENV } from "../../../../src/cli/wakeup-outcome.js";
import { inspectLock } from "../../../../src/lib/file-lock.js";
import { makeTmpBox } from "../../../helpers/test-helpers.js";

/** Collect what the cycle printed instead of letting it reach the test output. */
async function capture(fn: () => unknown) {
  const original = console.log;
  const lines: string[] = [];
  console.log = (text: unknown) => { lines.push(String(text)); };
  try {
    await fn();
  } finally {
    console.log = original;
  }
  return lines;
}

// ## The second cycle skips, and says so
//
// The outer call models a wakeup that is mid-cycle; the inner one is a second
// `bbx wakeup` arriving while it runs. The inner cycle's body never executes.
void test("The outer call models a wakeup that is mid-cycle; the inner one is a second b...", async (t) => {
  t.teardown(async () => {
    try {
      delete process.env[WAKEUP_OUTCOME_ENV];
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  process.env[WAKEUP_OUTCOME_ENV] = "1";

  const second: { ran: boolean | null; didWork: boolean } = { ran: null, didWork: false };
  const printed = await capture(async () => {
    await runUnderWakeupCycleLock(box.root, async () => {
      second.ran = await runUnderWakeupCycleLock(box.root, async () => {
        second.didWork = true;
      });
    });
  });

  t.check(second, { ran: false, didWork: false });

  // It is one visible line, not a silent no-op — a skipped cycle that printed
  // nothing would read as a cycle that found nothing to do:

  // The outer cycle took the lock, so it printed the acquired line (the caller
  // asked for the outcome); the inner one skipped and printed no such line.

  t.check(printed, [
    WAKEUP_CYCLE_ACQUIRED,
    WAKEUP_ALREADY_RUNNING,
    '[wakeup-outcome] {"connectorErrors":0,"connectors":[],"reactorOk":true,"reactorSkipped":false,"jobsProcessed":0,"jobsRemaining":0,"skipped":"wakeup-running"}',
  ]);

  // ## The outcome carries the skip
  //
  // Every count is zero because nothing ran, so a supervisor that read only the
  // counts would take "0 errors, reactor ok" as an answer about work that never
  // started. `skipped` is what distinguishes the two.

  const outcome = parseWakeupOutcome(printed.join("\n"));
  t.check(outcome, {
    connectorErrors: 0,
    connectors: [],
    reactorOk: true,
    reactorSkipped: false,
    jobsProcessed: 0,
    jobsRemaining: 0,
    skipped: "wakeup-running",
  });

  // An unrecognized skip value is "no information", not a skip — the parser refuses
  // the whole line rather than passing a value callers cannot dispatch on:

  t.check(parseWakeupOutcome(`[wakeup-outcome] ${JSON.stringify({ ...outcome, skipped: "something-else" })}`), null);

  // ## The lock is released, so the next cycle runs normally

  t.check(await inspectLock(wakeupCycleLockPath(box.root)), null);

  let thirdCycleDidWork = false;
  t.check(await runUnderWakeupCycleLock(box.root, async () => { thirdCycleDidWork = true; }), true);

  t.check(thirdCycleDidWork, true);
});

// ## The acquired line is for a caller that asked
//
// `startBbxWakeup` answers on `[wakeup-cycle] acquired`, which is printed once
// the lock is held and before the cycle's work. A person's own `bbx engine
// wakeup` sets no outcome variable and prints nothing extra.
void test("The acquired line is for a caller that asked", async (t) => {
  const box = await makeTmpBox();
  t.teardown(async () => {
    delete process.env[WAKEUP_OUTCOME_ENV];
    await box.cleanup();
  });

  const quiet = await capture(() => runUnderWakeupCycleLock(box.root, async () => {
    console.log("cycle work");
  }));
  process.env[WAKEUP_OUTCOME_ENV] = "1";
  const asked = await capture(() => runUnderWakeupCycleLock(box.root, async () => {
    const holder = await inspectLock(wakeupCycleLockPath(box.root));
    console.log(`cycle work, lock held by ${String(holder?.metadata.purpose)}`);
  }));
  t.check({ quiet, asked }, {
    quiet: ["cycle work"],
    asked: [WAKEUP_CYCLE_ACQUIRED, "cycle work, lock held by wakeup-cycle"],
  });
});
