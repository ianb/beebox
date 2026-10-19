// # Schedule State
//
// Functions for managing scheduled script run records, state persistence,
// and lock files.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { isoDate } from "@ianbicking/tap-check/check";
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
  t.check(pruneRecentRuns(undefined, { windowMs: 3_600_000, now: new Date("2026-03-01T12:00:00Z") }), undefined);

  t.check(pruneRecentRuns([], { windowMs: 3_600_000, now: new Date("2026-03-01T12:00:00Z") }), undefined);
});

// Recent runs within the window are kept:
void test("Recent runs within the window are kept:", async (t) => {
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
  const state2 = freshState();
  state2.recentRuns = [{ ts: "2026-03-01T10:00:00Z", durationMs: 1000 }];
  recordRun(state2, {
    record: { ts: "2026-03-01T12:00:00Z", durationMs: 2000 },
    windowMs: 3_600_000,
    now: new Date("2026-03-01T12:00:00Z"),
  });
  t.check(state2.recentRuns, [{ ts: "2026-03-01T12:00:00Z", durationMs: 2000 }]);
});

// ## recordOutcome
//
// The single outcome-recording path for all triggers (tick, wakeup, webapp).
// Failures track `consecutiveFailures` and leave `lastSuccess` untouched;
// a success resets the failure count, stamps `lastSuccess`, and clears the
// health-alert latch.
void test("The single outcome-recording path for all triggers (tick, wakeup, webapp).", async (t) => {
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
  t.check(st, {
    lastRun: "2026-03-01T13:00:00.000Z",
    lastResult: "failure",
    lastError: "boom again",
    lastDurationMs: 100,
    lastSuccess: null,
    consecutiveFailures: 2,
    alertedAt: "2026-03-01T13:01:00Z",
    alertedFor: "failing",
    skipped: null,
    runCount: 2,
    lastCommit: null,
    carry: null,
    lastDeferReason: null,
    recentRuns: [
      { ts: "2026-03-01T12:00:00.000Z", durationMs: 100 },
      { ts: "2026-03-01T13:00:00.000Z", durationMs: 100 },
    ],
  });

  recordOutcome(st, {
    result: "success", error: null, durationMs: 200, sleepAffected: false,
    windowMs: 3_600_000, now: new Date("2026-03-01T14:00:00Z"),
  });
  t.check(st, {
    lastRun: "2026-03-01T14:00:00.000Z",
    lastResult: "success",
    lastError: null,
    lastDurationMs: 200,
    lastSuccess: "2026-03-01T14:00:00.000Z",
    consecutiveFailures: 0,
    alertedAt: null,
    alertedFor: null,
    skipped: null,
    runCount: 3,
    lastCommit: null,
    carry: null,
    lastDeferReason: null,
    recentRuns: [
      { ts: "2026-03-01T13:00:00.000Z", durationMs: 100 },
      { ts: "2026-03-01T14:00:00.000Z", durationMs: 200 },
    ],
  });
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
  const oldSuccess = normalizeScriptState({ lastRun: "2026-03-01T06:00:00Z", lastResult: "success" });
  const oldFailure = normalizeScriptState({ lastRun: "2026-03-01T06:00:00Z", lastResult: "failure" });
  t.check({ oldSuccess, oldFailure }, {
    oldSuccess: {
      lastRun: "2026-03-01T06:00:00Z",
      lastResult: "success",
      lastError: null,
      lastDurationMs: null,
      lastSuccess: "2026-03-01T06:00:00Z",
      consecutiveFailures: 0,
      alertedAt: null,
      alertedFor: null,
      skipped: null,
      runCount: 0,
      lastCommit: null,
      carry: null,
      lastDeferReason: null,
    },
    oldFailure: {
      lastRun: "2026-03-01T06:00:00Z",
      lastResult: "failure",
      lastError: null,
      lastDurationMs: null,
      lastSuccess: null,
      consecutiveFailures: 1,
      alertedAt: null,
      alertedFor: null,
      skipped: null,
      runCount: 0,
      lastCommit: null,
      carry: null,
      lastDeferReason: null,
    },
  });
});

// ## loadScriptState / saveScriptState
//
// ### Loading nonexistent state returns empty
void test("Loading nonexistent state returns empty", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  await t.check(loadScriptState(box.root, "nonexistent"), {
    lastRun: null,
    lastResult: null,
    lastError: null,
    lastDurationMs: null,
    lastSuccess: null,
    consecutiveFailures: 0,
    alertedAt: null,
    alertedFor: null,
    skipped: null,
    runCount: 0,
    lastCommit: null,
    carry: null,
    lastDeferReason: null,
  });
});

// ### Save then load round-trips
void test("Save then load round-trips", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
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
  await t.check(loadScriptState(box.root, "test-script"), {
    lastRun: "2025-01-15T06:00:00Z",
    lastResult: "success",
    lastError: null,
    lastDurationMs: 8300,
    lastSuccess: "2025-01-15T06:00:00Z",
    consecutiveFailures: 0,
    alertedAt: null,
    alertedFor: null,
    skipped: null,
    runCount: 3,
    lastCommit: null,
    carry: null,
    lastDeferReason: null,
    recentRuns: [
      { ts: "2025-01-15T06:00:00Z", durationMs: 8300 },
    ],
  });
});

// ## Lock files
//
// ### Acquire and load shows running script
void test("Acquire and load shows running script", async (t) => {
  t.teardown(async () => {
    try {
      await releaseScriptLock({ boxRoot: box.root, scriptName: "my-script" });
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  await acquireScriptLock({ boxRoot: box.root, scriptName: "my-script", triggeredBy: "schedule" });
  const running = await loadRunningScripts(box.root);
  t.check([...running], [["my-script", { pid: process.pid, startedAt: isoDate(), triggeredBy: "schedule" }]]);
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
  const box = await makeTmpBox();
  await acquireScriptLock({ boxRoot: box.root, scriptName: "temp", triggeredBy: "test" });
  await releaseScriptLock({ boxRoot: box.root, scriptName: "temp" });
  const running = await loadRunningScripts(box.root);
  t.check([...running], []);
});

// ### Lock with lock-group
void test("Lock with lock-group", async (t) => {
  t.teardown(async () => {
    try {
      await releaseScriptLock({ boxRoot: box.root, scriptName: "grouped" });
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  await acquireScriptLock({ boxRoot: box.root, scriptName: "grouped", triggeredBy: "schedule", lockGroup: "agents" });
  const running = await loadRunningScripts(box.root);
  t.check(running.get("grouped"), { pid: process.pid, startedAt: isoDate(), triggeredBy: "schedule", lockGroup: "agents" });
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
  const box = await makeTmpBox();
  const stateDir = box.root + "/_config/schedules/.state";
  await fs.mkdir(stateDir, { recursive: true });
  await fs.writeFile(stateDir + "/dead-script.lock", JSON.stringify({
    pid: 99999999,
    startedAt: "2025-01-15T06:00:00Z",
    triggeredBy: "test",
  }) + "\n");

  const running = await loadRunningScripts(box.root);
  t.check([...running], []);
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
  const box = await makeTmpBox();
  const running = await loadRunningScripts(box.root);
  t.check([...running], []);
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
  const box = await makeTmpBox();
  const runDir = box.root + "/_bookkeeping/procedure/runs/test-run_2026-05-16T1200";
  await fs.mkdir(runDir, { recursive: true });
  await fs.writeFile(runDir + "/run.procedure-run.card",
    "---\nprocedure: test\nstarted-at: 2026-05-16T12:00:00Z\nsteps: []\n---\n");
  const doneDir = box.root + "/_bookkeeping/procedure/runs/done-run_2026-05-16T1100";
  await fs.mkdir(doneDir, { recursive: true });
  await fs.writeFile(doneDir + "/run.procedure-run.card",
    "---\nprocedure: test\noutcome: failed\nstarted-at: 2026-05-16T11:00:00Z\nsteps:\n  - id: s\n    status: running\n---\n");

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
  const box = await makeTmpBox();
  const runDir = box.root + "/_bookkeeping/procedure/runs/orphan_2026-03-16T2056";
  await fs.mkdir(runDir, { recursive: true });
  const cardPath = runDir + "/run.procedure-run.card";
  await fs.writeFile(cardPath,
    "---\nprocedure: test\nstarted-at: 2026-03-16T20:56:00Z\nsteps: []\n---\n");

  // Backdate the run card to two hours ago.
  const twoHoursAgo = (Date.now() - 2 * 60 * 60 * 1000) / 1000;
  await utimes(cardPath, twoHoursAgo, twoHoursAgo);

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
  const box = await makeTmpBox();
  for (const [name, outcome] of [["completed_run", "completed"], ["failed_run", "failed"], ["unjudged_run", "inconclusive"]]) {
    const runDir = box.root + "/_bookkeeping/procedure/runs/" + name;
    await fs.mkdir(runDir, { recursive: true });
    await fs.writeFile(runDir + "/run.procedure-run.card",
      `---\nprocedure: test\noutcome: ${outcome}\nstarted-at: 2026-05-16T12:00:00Z\nsteps: []\n---\n`);
  }

  t.check(await loadRunningProcedures(box.root), []);
});
