// # Scheduled runs that reached no verdict
//
// A scheduled command whose *work* completed but whose *check* never decided is
// neither a success nor a failure. It exits with `INCONCLUSIVE_EXIT_CODE` (3 —
// 2 already means "migration applied with per-card failures") and prints one
// `Inconclusive:` line on stderr; the scheduler recognizes that pair, records
// `lastResult: "inconclusive"`, and leaves the failure counter alone.
//
// The rule these tests pin down: a diagnostic reports what it knows at the
// resolution it knows it, and says "inconclusive" where it doesn't — it never
// collapses a non-verdict into a verdict.

import { test } from "tap";
import "agent-doctest/tap";
import { printed } from "agent-doctest/check";
import * as path from "node:path";
import * as os from "node:os";
import * as fs from "node:fs/promises";
import { classifyScheduleFailure } from "../../../src/core/schedule/engine-wait.js";
import { recordOutcome, normalizeScriptState } from "../../../src/core/schedule/state.js";
import { scheduleOutcomeLine } from "../../../src/shared/schedule-error.js";
import {
  CommandFailedError,
  CommandTimedOutError,
} from "../../../src/lib/exec-with-timeout.js";
import {
  INCONCLUSIVE_EXIT_CODE,
  formatInconclusiveLine,
  formatHandleInconclusiveLine,
  classifyInconclusiveReason,
} from "../../../src/shared/inconclusive.js";

const TIMING = { durationMs: 1200, sleepAffected: false };
const NOW = new Date();

// No availability record, so nothing here classifies as `deferred`.
const dir = await fs.mkdtemp(path.join(os.tmpdir(), "inconclusive-"));
process.env.BBX_ENGINE_AVAILABILITY_FILE = path.join(dir, "empty.json");

function commandFailure({ exitCode, stderr, stdout }: { exitCode: number; stderr?: string; stdout?: string }) {
  const parts = [`Command failed with exit code ${exitCode}`];
  if (stderr) parts.push(`stderr:\n${stderr}`);
  const out = stdout ?? "All MAP.md files current.";
  if (out) parts.push(`stdout:\n${out}`);
  return new CommandFailedError(parts.join("\n"), { timing: TIMING, exitCode });
}

const MARKER = formatInconclusiveLine({
  procedure: "refresh-maps",
  stepId: "maps",
  detail: "reached max turns (16)",
});

// ## Both signals are required
//
// The dedicated exit code and the marker line together. Either alone is
// ambiguous — another tool may exit with the same code, and the phrase could show
// up in unrelated output — and mislabeling a real failure as a non-answer is the
// one direction of error this must never make.
void test("The dedicated exit code and the marker line together.", async (t) => {
  const out2 = printed();
  const print = out2.print;
  // doctest:L60
  const both = await classifyScheduleFailure({
    boxRoot: "/nonexistent",
    runStartedAt: NOW,
    error: commandFailure({ exitCode: INCONCLUSIVE_EXIT_CODE, stderr: MARKER }),
  });
  print(`${both.result}`);
  await t.checkText(out2.with(print(both.error)), `inconclusive
Inconclusive: procedure refresh-maps — review of step maps reached max turns (16); work completed`);

  // doctest:L73
  // Right code, no marker → an ordinary failure.
  const codeOnly = await classifyScheduleFailure({
    boxRoot: "/nonexistent",
    runStartedAt: NOW,
    error: commandFailure({ exitCode: INCONCLUSIVE_EXIT_CODE, stderr: "Error: something else failed" }),
  });
  // Marker text, wrong exit code → also an ordinary failure.
  const markerOnly = await classifyScheduleFailure({
    boxRoot: "/nonexistent",
    runStartedAt: NOW,
    error: commandFailure({ exitCode: 1, stderr: MARKER }),
  });
  // A timeout is a failure, not a non-verdict.
  const timedOut = await classifyScheduleFailure({
    boxRoot: "/nonexistent",
    runStartedAt: NOW,
    error: new CommandTimedOutError("Command timed out after 600000ms", TIMING),
  });
  await t.checkText(out2.with(print(`${codeOnly.result}, ${markerOnly.result}, ${timedOut.result}`)), "failure, failure, failure");
});

// ## The marker has to be on stderr, in full
//
// The error message a failed command raises carries a tail of the child's
// *stdout* too, and stdout is arbitrary text: a shell task can print the word
// while genuinely failing, and an agent can quote its own diagnosis. Reading
// either as "no verdict" would launder a real failure. Only the `stderr:` section
// counts, and only a line in the exact shape `formatInconclusiveLine` produces.
void test("The error message a failed command raises carries a tail of the child's stdou...", async (t) => {
  const out2 = printed();
  const print = out2.print;
  // doctest:L104
  // A shell task that exits with the inconclusive code and prints the phrase on
  // STDOUT — nothing said it on the diagnostic channel.
  const onStdout = await classifyScheduleFailure({
    boxRoot: "/nonexistent",
    runStartedAt: NOW,
    error: commandFailure({
      exitCode: INCONCLUSIVE_EXIT_CODE,
      stderr: "",
      stdout: `checking...\n${MARKER}\nexiting`,
    }),
  });
  // Right channel, right code, but only the opening word — not this vocabulary.
  const prefixOnly = await classifyScheduleFailure({
    boxRoot: "/nonexistent",
    runStartedAt: NOW,
    error: commandFailure({
      exitCode: INCONCLUSIVE_EXIT_CODE,
      stderr: "Inconclusive: something went sideways",
    }),
  });
  print(`${onStdout.result}, ${prefixOnly.result}`);
  await t.checkText(out2.with(print(onStdout.error.split("\n")[0])), `failure, failure
Command failed with exit code 3`);
});

// ## `bbx handle` speaks the same line
//
// Its unjudged unit is a category bucket rather than a procedure step, so the
// scheduler classifies a scheduled `bbx handle` from the same pair of signals.
void test("Its unjudged unit is a category bucket rather than a procedure step, so the s...", async (t) => {
  const out2 = printed();
  const print = out2.print;
  // doctest:L137
  const handleLine = formatHandleInconclusiveLine({
    category: "receipts",
    detail: "review of step file reached max turns (8)",
  });
  const handled = await classifyScheduleFailure({
    boxRoot: "/nonexistent",
    runStartedAt: NOW,
    error: commandFailure({ exitCode: INCONCLUSIVE_EXIT_CODE, stderr: handleLine }),
  });
  print(handleLine);
  await t.checkText(out2.with(print(handled.result)), `Inconclusive: handle receipts — review of step file reached max turns (8); work completed
inconclusive`);
});

// ## Recording it freezes the failure counter
//
// Neither incremented (nothing failed) nor reset (a genuinely broken task must
// not have its count laundered by an undecided review). `lastSuccess` stays put
// too: an unjudged run is not a confirmed one.
void test("Neither incremented (nothing failed) nor reset (a genuinely broken task must...", async (t) => {
  const out2 = printed();
  const print = out2.print;
  // doctest:L160
  const state = normalizeScriptState({
    lastResult: "failure",
    consecutiveFailures: 3,
    lastSuccess: "2026-06-06T05:00:10Z",
  });
  recordOutcome(state, {
    result: "inconclusive",
    error: MARKER,
    durationMs: 1200,
    sleepAffected: false,
    windowMs: 24 * 60 * 60 * 1000,
    now: new Date("2026-06-09T12:00:00Z"),
  });
  print(`${state.lastResult}, failures: ${state.consecutiveFailures}`);
  print(`lastRun: ${state.lastRun}`);
  await t.checkText(out2.with(print(`lastSuccess: ${state.lastSuccess}`)), `inconclusive, failures: 3
lastRun: 2026-06-09T12:00:00.000Z
lastSuccess: 2026-06-06T05:00:10Z`);
});

// ## The console line doesn't say "Failed"
void test("The console line doesn't say \"Failed\"", async (t) => {
  const out2 = printed();
  const print = out2.print;
  // doctest:L185
  print(scheduleOutcomeLine({ result: "inconclusive", error: MARKER }));
  print(scheduleOutcomeLine({ result: "deferred", error: "waiting on codex quota" }));
  await t.checkText(out2.with(print(scheduleOutcomeLine({ result: "failure", error: "boom" }))), `Inconclusive: procedure refresh-maps — review of step maps reached max turns (16); work completed
Deferred: waiting on codex quota
Failed: boom`);
});

// ## Reasons stay distinct
//
// A turn cap is a *budget* problem — a cap set too low, or a judge prompt that
// wanders — which is a different fix from a timeout or unparseable output. The
// tag records which.
void test("A turn cap is a budget problem — a cap set too low, or a judge prompt that wa...", async (t) => {
  const out2 = printed();
  const print = out2.print;
  t.teardown(async () => {
    try {
      await fs.rm(dir, { recursive: true, force: true });
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L201
  print(classifyInconclusiveReason("error_max_turns"));
  print(classifyInconclusiveReason("Reached maximum number of turns (8)"));
  print(classifyInconclusiveReason("error_max_budget_usd"));
  print(classifyInconclusiveReason("Structured output: no JSON found in result"));
  print(classifyInconclusiveReason("the request timed out"));
  await t.checkText(out2.with(print(classifyInconclusiveReason("something nobody anticipated"))), `max-turns
max-turns
max-budget
no-structured-output
timeout
unknown`);
});
