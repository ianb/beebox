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
import { any, eventually, instanceOf } from "agent-doctest/check";
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

  t.check(state.fired, { awakeMs: any(Number).between(60, Infinity), wallMs: any(Number).positive(), sleepDetected: false });
});

// A gap between ticks far larger than the period means the machine slept (here
// simulated by blocking the event loop so the interval can't fire). The gap is
// flagged but not counted toward the deadline. The blocked gap of at least 150ms
// is credited one 10ms period at most, so wall time exceeds awake time by at
// least 140ms however slow the surrounding sleeps run:
void test("A gap between ticks far larger than the period means the machine slept (here...", async (t) => {
  // doctest:L51
  let fired = null;
  const timer = startAwakeTimeout({ timeoutMs: 5_000, periodMs: 10, sleepGapMs: 60, onTimeout: (e) => { fired = e; } });
  await sleep(40);
  const blockUntil = Date.now() + 150;
  while (Date.now() < blockUntil) { /* "sleep" */ }
  await sleep(40);
  const elapsed = timer.elapsed();
  timer.stop();
  t.check(fired, null);
  t.check(elapsed, { awakeMs: any(Number).positive(), wallMs: any(Number).positive(), sleepDetected: true });
  t.check(elapsed.wallMs - elapsed.awakeMs, any(Number).between(140, Infinity));
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
  // doctest:L93
  const timing = await execWithTimeout("true", { cwd: process.cwd(), stdio: "ignore", timeout: 5_000, env: process.env });
  t.check(timing, { durationMs: any(Number), sleepAffected: false });
});

// A non-zero exit rejects with `CommandFailedError`, carrying the exit code,
// output tails, and the same timing:
void test("A non-zero exit rejects with CommandFailedError, carrying the exit code, outp...", async (t) => {
  // doctest:L107
  const err = await execWithTimeout("echo oops >&2; exit 3", { cwd: process.cwd(), stdio: "ignore", timeout: 5_000, env: process.env }).catch((e) => e);
  t.check(err, {
    name: "CommandFailedError",
    message: `Command failed with exit code 3
stderr:
oops`,
    timing: { durationMs: any(Number), sleepAffected: false },
    exitCode: 3,
  });
  t.check(err, instanceOf(CommandFailedError));
  t.check(err, instanceOf(CommandError));
});

// A command that outlives its awake-time budget is killed (whole process group,
// SIGKILL) and rejects with `CommandTimedOutError`:
void test("A command that outlives its awake-time budget is killed (whole process group,...", async (t) => {
  // doctest:L127
  const err = await execWithTimeout("sleep 30", { cwd: process.cwd(), stdio: "ignore", timeout: 50, periodMs: 10, env: process.env }).catch((e) => e);
  t.check(err, {
    name: "CommandTimedOutError",
    message: "Command timed out after 50ms of awake runtime",
    timing: { durationMs: any(Number).between(50, Infinity), sleepAffected: false },
  });
  t.check(err, instanceOf(CommandTimedOutError));
  t.check(err, instanceOf(CommandError));
});
