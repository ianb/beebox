// # Schedule State
//
// Functions for managing scheduled script run records, state persistence,
// and lock files.

import { test } from "tap";
import "agent-doctest/tap";
import { printed } from "agent-doctest/check";
import {
  pruneRecentRuns,
  recordRun,
  recordOutcome,
  normalizeScriptState,
  loadScriptState,
  saveScriptState,
  acquireScriptLock,
  releaseScriptLock,
  loadRunningScripts,
} from "../../../src/core/schedule/state.js";
import { loadRunningProcedures } from "../../../src/core/schedule/running-procedures.js";
import { makeTmpBox } from "../../helpers/test-helpers.js";
import * as fs from "node:fs/promises";
import { utimes } from "node:fs/promises";

// ## recordRun
//
// Appends a run record to the state and prunes old entries. Mutates the state object in place.
function freshState() {
  return normalizeScriptState({});
}

// ## pruneRecentRuns
//
// Removes run records older than the given window. Returns `undefined` when all records are pruned (so the field can be omitted from JSON).
//
// No runs returns undefined:
void test("Removes run records older than the given window.", async (t) => {
  // doctest:L31
  t.check(pruneRecentRuns(undefined, { windowMs: 3_600_000, now: new Date("2026-03-01T12:00:00Z") }), undefined);

  // doctest:L34
  t.check(pruneRecentRuns([], { windowMs: 3_600_000, now: new Date("2026-03-01T12:00:00Z") }), undefined);
});

// Recent runs within the window are kept:
void test("Recent runs within the window are kept:", async (t) => {
  // doctest:L41
  t.check(
    pruneRecentRuns(
      [{ ts: "2026-03-01T11:30:00Z", durationMs: 5000 }],
      { windowMs: 3_600_000, now: new Date("2026-03-01T12:00:00Z") }
    ),
    [
    {
      ts: "2026-03-01T11:30:00Z",
      durationMs: 5000,
    },
  ],
  );
});

// Old runs outside the window are removed:
void test("Old runs outside the window are removed:", async (t) => {
  // doctest:L51
  t.check(
    pruneRecentRuns(
      [{ ts: "2026-03-01T10:00:00Z", durationMs: 5000 }],
      { windowMs: 3_600_000, now: new Date("2026-03-01T12:00:00Z") }
    ),
    undefined,
  );
});

// Old records are pruned during recording:
void test("Old records are pruned during recording:", async (t) => {
  // doctest:L71
  const state2 = freshState();
  state2.recentRuns = [{ ts: "2026-03-01T10:00:00Z", durationMs: 1000 }];
  recordRun(state2, {
    record: { ts: "2026-03-01T12:00:00Z", durationMs: 2000 },
    windowMs: 3_600_000,
    now: new Date("2026-03-01T12:00:00Z"),
  });
  await t.checkText(state2.recentRuns.length, "1");

  // doctest:L81
  t.check(state2.recentRuns[0]?.ts, "2026-03-01T12:00:00Z");
});

// ## recordOutcome
//
// The single outcome-recording path for all triggers (tick, wakeup, webapp).
// Failures track `consecutiveFailures` and leave `lastSuccess` untouched;
// a success resets the failure count, stamps `lastSuccess`, and clears the
// health-alert latch.
void test("The single outcome-recording path for all triggers (tick, wakeup, webapp).", async (t) => {
  const out = printed();
  const print = out.print;
  // doctest:L93
  const st = normalizeScriptState({});
  recordOutcome(st, {
    result: "failure", error: "boom", durationMs: 100, sleepAffected: false,
    windowMs: 3_600_000, now: new Date("2026-03-01T12:00:00Z"),
  });
  recordOutcome(st, {
    result: "failure", error: "boom again", durationMs: 100, sleepAffected: false,
    windowMs: 3_600_000, now: new Date("2026-03-01T13:00:00Z"),
  });
  st.alertedAt = "2026-03-01T13:01:00Z";
  st.alertedFor = "failing";
  print(`consecutiveFailures: ${st.consecutiveFailures}`);
  print(`lastResult: ${st.lastResult}, lastError: ${st.lastError}`);
  await t.checkText(out.with(print(`lastSuccess: ${st.lastSuccess}`)), `consecutiveFailures: 2
lastResult: failure, lastError: boom again
lastSuccess: null`);

  // doctest:L112
  recordOutcome(st, {
    result: "success", error: null, durationMs: 200, sleepAffected: false,
    windowMs: 3_600_000, now: new Date("2026-03-01T14:00:00Z"),
  });
  print(`consecutiveFailures: ${st.consecutiveFailures}`);
  print(`lastSuccess: ${st.lastSuccess}`);
  print(`latch: ${st.alertedAt}, ${st.alertedFor}`);
  await t.checkText(out.with(print(`runCount: ${st.runCount}, recentRuns: ${st.recentRuns?.length}`)), `consecutiveFailures: 0
lastSuccess: 2026-03-01T14:00:00.000Z
latch: null, null
runCount: 3, recentRuns: 2`);
});

// (The 12:00 failure has aged out of the one-hour run window by 14:00 —
// `runCount` is lifetime, `recentRuns` is windowed.)
//
// ## normalizeScriptState
//
// State files written before the health fields existed get a best-effort
// backfill: a last-succeeded state inherits `lastSuccess` from `lastRun`,
// a last-failed state counts as one failure.
void test("(The 12:00 failure has aged out of the one-hour run window by 14:00 — runCoun...", async (t) => {
  const out = printed();
  const print = out.print;
  // doctest:L137
  const oldSuccess = normalizeScriptState({ lastRun: "2026-03-01T06:00:00Z", lastResult: "success" });
  print(`lastSuccess: ${oldSuccess.lastSuccess}, consecutiveFailures: ${oldSuccess.consecutiveFailures}`);
  const oldFailure = normalizeScriptState({ lastRun: "2026-03-01T06:00:00Z", lastResult: "failure" });
  await t.checkText(out.with(print(`lastSuccess: ${oldFailure.lastSuccess}, consecutiveFailures: ${oldFailure.consecutiveFailures}`)), `lastSuccess: 2026-03-01T06:00:00Z, consecutiveFailures: 0
lastSuccess: null, consecutiveFailures: 1`);
});

// ## loadScriptState / saveScriptState
//
// ### Loading nonexistent state returns empty
void test("Loading nonexistent state returns empty", async (t) => {
  const out = printed();
  const print = out.print;
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L151
  const box = await makeTmpBox();
  const state = await loadScriptState(box.root, "nonexistent");
  print(`lastRun: ${state.lastRun}`);
  print(`lastResult: ${state.lastResult}`);
  print(`lastDurationMs: ${state.lastDurationMs}`);
  await t.checkText(out.with(print(`runCount: ${state.runCount}`)), `lastRun: null
lastResult: null
lastDurationMs: null
runCount: 0`);
});

// ### Save then load round-trips
void test("Save then load round-trips", async (t) => {
  const out = printed();
  const print = out.print;
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L171
  const box = await makeTmpBox();
  const saved = normalizeScriptState({
    lastRun: "2025-01-15T06:00:00Z",
    lastResult: "success",
    lastError: null,
    lastDurationMs: 8300,
    runCount: 3,
    recentRuns: [{ ts: "2025-01-15T06:00:00Z", durationMs: 8300 }],
  });
  await saveScriptState({ boxRoot: box.root, scriptName: "test-script", state: saved });
  const loaded = await loadScriptState(box.root, "test-script");
  print(`lastRun: ${loaded.lastRun}`);
  print(`lastResult: ${loaded.lastResult}`);
  print(`lastDurationMs: ${loaded.lastDurationMs}`);
  print(`runCount: ${loaded.runCount}`);
  await t.checkText(out.with(print(`recentRuns: ${loaded.recentRuns?.length}`)), `lastRun: 2025-01-15T06:00:00Z
lastResult: success
lastDurationMs: 8300
runCount: 3
recentRuns: 1`);
});

// ## Lock files
//
// ### Acquire and load shows running script
void test("Acquire and load shows running script", async (t) => {
  const out = printed();
  const print = out.print;
  t.teardown(async () => {
    try {
      await releaseScriptLock({ boxRoot: box.root, scriptName: "my-script" });
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L204
  const box = await makeTmpBox();
  await acquireScriptLock({ boxRoot: box.root, scriptName: "my-script", triggeredBy: "schedule" });
  const running = await loadRunningScripts(box.root);
  print(`running: ${running.size}`);
  print(`has my-script: ${running.has("my-script")}`);
  const lock = running.get("my-script");
  await t.checkText(out.with(print(`triggeredBy: ${lock?.triggeredBy}`)), `running: 1
has my-script: true
triggeredBy: schedule`);
});

// ### Release removes from running
void test("Release removes from running", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L225
  const box = await makeTmpBox();
  await acquireScriptLock({ boxRoot: box.root, scriptName: "temp", triggeredBy: "test" });
  await releaseScriptLock({ boxRoot: box.root, scriptName: "temp" });
  const running = await loadRunningScripts(box.root);
  await t.checkText(running.size, "0");
});

// ### Lock with lock-group
void test("Lock with lock-group", async (t) => {
  const out = printed();
  const print = out.print;
  t.teardown(async () => {
    try {
      await releaseScriptLock({ boxRoot: box.root, scriptName: "grouped" });
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L240
  const box = await makeTmpBox();
  await acquireScriptLock({ boxRoot: box.root, scriptName: "grouped", triggeredBy: "schedule", lockGroup: "agents" });
  const running = await loadRunningScripts(box.root);
  const lock = running.get("grouped");
  await t.checkText(out.with(print(`lockGroup: ${lock?.lockGroup}`)), "lockGroup: agents");
});

// ### Stale lock (dead PID) is cleaned up
void test("Stale lock (dead PID) is cleaned up", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L257
  const box = await makeTmpBox();
  const stateDir = box.root + "/_config/schedules/.state";
  await fs.mkdir(stateDir, { recursive: true });
  await fs.writeFile(stateDir + "/dead-script.lock", JSON.stringify({
    pid: 99999999,
    startedAt: "2025-01-15T06:00:00Z",
    triggeredBy: "test",
  }) + "\n");

  // doctest:L266
  const running = await loadRunningScripts(box.root);
  await t.checkText(running.size, "0");
});

// ### No state directory returns empty map
void test("No state directory returns empty map", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L278
  const box = await makeTmpBox();
  const running = await loadRunningScripts(box.root);
  await t.checkText(running.size, "0");
});

// ## loadRunningProcedures
//
// Reads `_bookkeeping/procedure/runs/*/run.procedure-run.card` and reports runs with
// no `outcome` yet — they have not finished. A finished run is not reported, even
// if a step inside it still says `running`.
//
// ### Reports recent running runs
void test("Reads bookkeeping/procedure/runs//run.procedure-run.card and reports runs wit...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L297
  const box = await makeTmpBox();
  const runDir = box.root + "/_bookkeeping/procedure/runs/test-run_2026-05-16T1200";
  await fs.mkdir(runDir, { recursive: true });
  await fs.writeFile(runDir + "/run.procedure-run.card",
    "---\nprocedure: test\nstarted-at: 2026-05-16T12:00:00Z\nsteps: []\n---\n");
  const doneDir = box.root + "/_bookkeeping/procedure/runs/done-run_2026-05-16T1100";
  await fs.mkdir(doneDir, { recursive: true });
  await fs.writeFile(doneDir + "/run.procedure-run.card",
    "---\nprocedure: test\noutcome: failed\nstarted-at: 2026-05-16T11:00:00Z\nsteps:\n  - id: s\n    status: running\n---\n");

  // doctest:L307
  t.check(await loadRunningProcedures(box.root), [
    "test-run_2026-05-16T1200",
  ]);
});

// ### Ignores stale run cards (mtime > 1 hour)
//
// A procedure that crashed mid-step leaves its run card without an outcome
// forever. To avoid blocking housekeeping on orphan corpses, cards whose
// mtime is older than one hour are treated as dead.
void test("A procedure that crashed mid-step leaves its run card without an outcome fore...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L324
  const box = await makeTmpBox();
  const runDir = box.root + "/_bookkeeping/procedure/runs/orphan_2026-03-16T2056";
  await fs.mkdir(runDir, { recursive: true });
  const cardPath = runDir + "/run.procedure-run.card";
  await fs.writeFile(cardPath,
    "---\nprocedure: test\nstarted-at: 2026-03-16T20:56:00Z\nsteps: []\n---\n");

  // doctest:L331
  // Backdate the run card to two hours ago.
  const twoHoursAgo = (Date.now() - 2 * 60 * 60 * 1000) / 1000;
  await utimes(cardPath, twoHoursAgo, twoHoursAgo);

  // doctest:L335
  t.check(await loadRunningProcedures(box.root), []);
});

// ### Ignores finished runs
void test("Ignores finished runs", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L346
  const box = await makeTmpBox();
  for (const [name, outcome] of [["completed_run", "completed"], ["failed_run", "failed"], ["unjudged_run", "inconclusive"]]) {
    const runDir = box.root + "/_bookkeeping/procedure/runs/" + name;
    await fs.mkdir(runDir, { recursive: true });
    await fs.writeFile(runDir + "/run.procedure-run.card",
      `---\nprocedure: test\noutcome: ${outcome}\nstarted-at: 2026-05-16T12:00:00Z\nsteps: []\n---\n`);
  }

  // doctest:L354
  t.check(await loadRunningProcedures(box.root), []);
});
