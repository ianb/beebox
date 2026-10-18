// # Sleep-immune command execution
//
// `execWithTimeout` runs a shell command in its own process group and kills the
// whole tree once the command exceeds its *awake-time* budget. The budget is
// tracked by `startAwakeTimeout`, which ticks a short interval and discards any
// tick gap far larger than the period — on macOS, libuv's timer clock counts
// system sleep, so a plain `setTimeout` would fire the instant the machine wakes
// and kill a run that barely got to execute.

import { test } from "tap";
import "agent-doctest/tap";
import { eventually, printed } from "agent-doctest/check";
import { startAwakeTimeout, type AwakeElapsed } from "../../src/shared/awake-timeout.js";
import {
  execWithTimeout,
  CommandError,
  CommandTimedOutError,
  CommandFailedError,
  SCRIPT_TIMEOUT,
} from "../../src/lib/exec-with-timeout.js";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// ## startAwakeTimeout
//
// Accumulates awake time across ticks and fires `onTimeout` when the budget is
// spent. Any tick gap at or above `sleepGapMs` counts as sleep and adds only one
// period, so an event-loop stall that long (a cold tsx compile, a loaded host)
// under-counts by design. This example sets the gap far above any stall and waits
// for the timeout to fire, rather than racing a fixed sleep against it:
void test("Accumulates awake time across ticks and fires onTimeout when the budget is sp...", async (t) => {
  // doctest:L32
  const state: { fired: AwakeElapsed | null } = { fired: null };
  startAwakeTimeout({ timeoutMs: 60, periodMs: 10, sleepGapMs: 5_000, onTimeout: (e) => { state.fired = e; } });
  t.check(await eventually(() => state.fired !== null, { label: "the awake timeout fires" }), true);

  // doctest:L37
  await t.checkText(state.fired !== null && state.fired.awakeMs >= 60, "true");

  // doctest:L40
  t.check(state.fired?.sleepDetected, false);
});

// A gap between ticks far larger than the period means the machine slept (here
// simulated by blocking the event loop so the interval can't fire). The gap is
// flagged but not counted toward the deadline. The blocked gap of at least 150ms
// is credited one 10ms period at most, so wall time exceeds awake time by at
// least 140ms however slow the surrounding sleeps run:
void test("A gap between ticks far larger than the period means the machine slept (here...", async (t) => {
  const out2 = printed();
  const print = out2.print;
  // doctest:L51
  let fired = null;
  const timer = startAwakeTimeout({ timeoutMs: 5_000, periodMs: 10, sleepGapMs: 60, onTimeout: (e) => { fired = e; } });
  await sleep(40);
  const blockUntil = Date.now() + 150;
  while (Date.now() < blockUntil) { /* "sleep" */ }
  await sleep(40);
  const elapsed = timer.elapsed();
  timer.stop();
  print(`fired: ${fired === null ? "no" : "yes"}`);
  print(`sleepDetected: ${elapsed.sleepDetected}`);
  print(`sleep excluded from awake: ${elapsed.wallMs - elapsed.awakeMs >= 140}`);
  await t.checkText(out2.with("done"), `fired: no
sleepDetected: true
sleep excluded from awake: true
done`);
});

// `stop()` freezes the awake counter; the timer never fires afterwards:
void test("stop() freezes the awake counter; the timer never fires afterwards:", async (t) => {
  // doctest:L73
  let fired = null;
  const timer = startAwakeTimeout({ timeoutMs: 30, periodMs: 10, onTimeout: (e) => { fired = e; } });
  timer.stop();
  await sleep(80);
  t.check(fired, null);
});

// ## execWithTimeout
//
// The default budget is 10 minutes of awake runtime:
void test("The default budget is 10 minutes of awake runtime:", async (t) => {
  // doctest:L86
  t.check(SCRIPT_TIMEOUT, 600000);
});

// A successful command resolves with its measured timing:
void test("A successful command resolves with its measured timing:", async (t) => {
  const out2 = printed();
  const print = out2.print;
  // doctest:L93
  const timing = await execWithTimeout("true", { cwd: process.cwd(), stdio: "ignore", timeout: 5_000, env: process.env });
  print(`durationMs is a number: ${typeof timing.durationMs === "number"}`);
  print(`sleepAffected: ${timing.sleepAffected}`);
  await t.checkText(out2.with("ran"), `durationMs is a number: true
sleepAffected: false
ran`);
});

// A non-zero exit rejects with `CommandFailedError`, carrying the exit code,
// output tails, and the same timing:
void test("A non-zero exit rejects with CommandFailedError, carrying the exit code, outp...", async (t) => {
  // doctest:L107
  const err = await execWithTimeout("echo oops >&2; exit 3", { cwd: process.cwd(), stdio: "ignore", timeout: 5_000, env: process.env }).catch((e) => e);
  await t.checkText(err instanceof CommandFailedError, "true");

  // doctest:L111
  await t.checkText(err instanceof CommandError, "true");

  // doctest:L114
  await t.checkText(err.message, `Command failed with exit code 3
stderr:
oops`);

  // doctest:L119
  t.check(typeof err.timing.durationMs, "number");
});

// A command that outlives its awake-time budget is killed (whole process group,
// SIGKILL) and rejects with `CommandTimedOutError`:
void test("A command that outlives its awake-time budget is killed (whole process group,...", async (t) => {
  // doctest:L127
  const err = await execWithTimeout("sleep 30", { cwd: process.cwd(), stdio: "ignore", timeout: 50, periodMs: 10, env: process.env }).catch((e) => e);
  await t.checkText(err instanceof CommandTimedOutError, "true");

  // doctest:L131
  await t.checkText(err.message.startsWith("Command timed out after 50ms of awake runtime"), "true");

  // doctest:L134
  await t.checkText(err.timing.durationMs >= 50, "true");
});
