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
import "@ianbicking/tap-check/tap";
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
  t.check(
    await classifyScheduleFailure({
      boxRoot: "/nonexistent",
      runStartedAt: NOW,
      error: commandFailure({ exitCode: INCONCLUSIVE_EXIT_CODE, stderr: MARKER }),
    }),
    {
      result: "inconclusive",
      error: "Inconclusive: procedure refresh-maps — review of step maps reached max turns (16); work completed",
    },
  );

  // Right code, no marker → an ordinary failure.
  const codeOnlyError = commandFailure({ exitCode: INCONCLUSIVE_EXIT_CODE, stderr: "Error: something else failed" });
  t.check(
    await classifyScheduleFailure({ boxRoot: "/nonexistent", runStartedAt: NOW, error: codeOnlyError }),
    { result: "failure", error: codeOnlyError.message },
  );
  // Marker text, wrong exit code → also an ordinary failure.
  const markerOnlyError = commandFailure({ exitCode: 1, stderr: MARKER });
  t.check(
    await classifyScheduleFailure({ boxRoot: "/nonexistent", runStartedAt: NOW, error: markerOnlyError }),
    { result: "failure", error: markerOnlyError.message },
  );
  // A timeout is a failure, not a non-verdict.
  const timedOutError = new CommandTimedOutError("Command timed out after 600000ms", TIMING);
  t.check(
    await classifyScheduleFailure({ boxRoot: "/nonexistent", runStartedAt: NOW, error: timedOutError }),
    { result: "failure", error: timedOutError.message },
  );
});

// ## The marker has to be on stderr, in full
//
// The error message a failed command raises carries a tail of the child's
// *stdout* too, and stdout is arbitrary text: a shell task can print the word
// while genuinely failing, and an agent can quote its own diagnosis. Reading
// either as "no verdict" would launder a real failure. Only the `stderr:` section
// counts, and only a line in the exact shape `formatInconclusiveLine` produces.
void test("The error message a failed command raises carries a tail of the child's stdou...", async (t) => {
  // A shell task that exits with the inconclusive code and prints the phrase on
  // STDOUT — nothing said it on the diagnostic channel.
  const onStdoutError = commandFailure({
    exitCode: INCONCLUSIVE_EXIT_CODE,
    stderr: "",
    stdout: `checking...\n${MARKER}\nexiting`,
  });
  t.check(
    await classifyScheduleFailure({ boxRoot: "/nonexistent", runStartedAt: NOW, error: onStdoutError }),
    { result: "failure", error: onStdoutError.message },
  );
  // Right channel, right code, but only the opening word — not this vocabulary.
  const prefixOnlyError = commandFailure({
    exitCode: INCONCLUSIVE_EXIT_CODE,
    stderr: "Inconclusive: something went sideways",
  });
  t.check(
    await classifyScheduleFailure({ boxRoot: "/nonexistent", runStartedAt: NOW, error: prefixOnlyError }),
    { result: "failure", error: prefixOnlyError.message },
  );
});

// ## `bbx handle` speaks the same line
//
// Its unjudged unit is a category bucket rather than a procedure step, so the
// scheduler classifies a scheduled `bbx handle` from the same pair of signals.
// The line's wording is pinned in `test/core/handle.test.ts`, next to the CLI
// that prints it.
void test("Its unjudged unit is a category bucket rather than a procedure step, so the s...", async (t) => {
  const handleLine = formatHandleInconclusiveLine({
    category: "receipts",
    detail: "review of step file reached max turns (8)",
  });
  t.check(
    await classifyScheduleFailure({
      boxRoot: "/nonexistent",
      runStartedAt: NOW,
      error: commandFailure({ exitCode: INCONCLUSIVE_EXIT_CODE, stderr: handleLine }),
    }),
    { result: "inconclusive", error: handleLine },
  );
});

// ## Recording it freezes the failure counter
//
// Neither incremented (nothing failed) nor reset (a genuinely broken task must
// not have its count laundered by an undecided review). `lastSuccess` stays put
// too: an unjudged run is not a confirmed one.
void test("Neither incremented (nothing failed) nor reset (a genuinely broken task must...", async (t) => {
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
  // Only the fields the rule is about; the rest of the record is `recordOutcome`'s
  // general bookkeeping, covered in `state.test.ts`.
  const { lastRun, lastResult, lastError, lastSuccess, consecutiveFailures } = state;
  t.check({ lastRun, lastResult, lastError, lastSuccess, consecutiveFailures }, {
    lastRun: "2026-06-09T12:00:00.000Z",
    lastResult: "inconclusive",
    lastError: MARKER,
    lastSuccess: "2026-06-06T05:00:10Z",
    consecutiveFailures: 3,
  });
});

// ## The console line doesn't say "Failed"
void test("The console line doesn't say \"Failed\"", async (t) => {
  // The line is the marker itself, with no `Failed:` prefix (the marker's wording
  // is pinned above, where the classifier reads it).
  t.check(scheduleOutcomeLine({ result: "inconclusive", error: MARKER }), MARKER);
  t.check(scheduleOutcomeLine({ result: "deferred", error: "waiting on codex quota" }), "Deferred: waiting on codex quota");
  t.check(scheduleOutcomeLine({ result: "failure", error: "boom" }), "Failed: boom");
});

// ## Reasons stay distinct
//
// A turn cap is a *budget* problem — a cap set too low, or a judge prompt that
// wanders — which is a different fix from a timeout or unparseable output. The
// tag records which.
void test("A turn cap is a budget problem — a cap set too low, or a judge prompt that wa...", async (t) => {
  t.teardown(async () => {
    try {
      await fs.rm(dir, { recursive: true, force: true });
    } catch (error) {
      t.error(error);
    }
  });
  t.check(
    [
      "error_max_turns",
      "Reached maximum number of turns (8)",
      "error_max_budget_usd",
      "Structured output: no JSON found in result",
      "the request timed out",
      "something nobody anticipated",
    ].map(classifyInconclusiveReason),
    ["max-turns", "max-turns", "max-budget", "no-structured-output", "timeout", "unknown"],
  );
});
