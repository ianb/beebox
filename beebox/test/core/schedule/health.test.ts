// # Scheduled-task health
//
// `evaluateTaskHealth` classifies a scheduled task from its card + run
// state: `ok`, `waiting`, `inconclusive`, `failing`, `overdue`, `blocked`,
// `invalid`, or `disabled`.
// The trust rule: a deliberate skip (budget, missing connector, disabled)
// must never be reported as overdue or failing — and neither must a
// non-answer (`inconclusive`), where nothing found a defect at all.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import {
  conciseScheduleError,
  evaluateTaskHealth,
} from "../../../src/core/schedule/health.js";
import { parseScheduledScript } from "../../../src/schemas/scheduled-script/schema.js";
import type { ScheduledScriptFields } from "../../../src/schemas/scheduled-script/schema.js";
import { normalizeScriptState } from "../../../src/core/schedule/state.js";
import {
  summarizeScheduleHealth,
  selectAlertableTasks,
} from "../../../src/core/schedule/health-box.js";
import type { SchedulerHeartbeat } from "../../../src/core/schedule/health-box.js";
import { formatDuration } from "../../../src/shared/relative-time.js";

const NOW = new Date("2026-06-09T12:00:00Z");

function makeScript(fields?: Partial<ScheduledScriptFields>) {
  return parseScheduledScript({ type: "scheduled-script", runs: "true", ...fields });
}

type StatePatch = Parameters<typeof normalizeScriptState>[0];
interface EvaluateOptions {
  fields?: Partial<ScheduledScriptFields>;
  state?: StatePatch;
  now?: Date;
  cardMtime?: Date;
  missingConnectors?: string[];
  engineWaitReason?: string | undefined;
}
function evaluate({ fields, state, now, cardMtime, missingConnectors, engineWaitReason }: EvaluateOptions) {
  return evaluateTaskHealth({
    name: "demo",
    parsed: makeScript(fields),
    state: normalizeScriptState(state ?? {}),
    now: now ?? NOW,
    cardMtime: cardMtime ?? new Date("2026-06-01T00:00:00Z"),
    missingConnectors: missingConnectors ?? [],
    engineWaitReason,
  });
}

/** The fields every health record in these tests shares. */
const BASE = { name: "demo", description: undefined, alertedAt: null, alertedFor: null };

const statusOf = (args: EvaluateOptions) => evaluate(args).status;

/** State of a task whose last attempt, at `when`, ended `result` ("success" also sets lastSuccess). */
const ran = (when: string, result?: "success" | "failure" | "deferred" | "inconclusive"): StatePatch => {
  const outcome = result ?? "success";
  return outcome === "success" ? { lastRun: when, lastResult: "success", lastSuccess: when } : { lastRun: when, lastResult: outcome };
};

const dailyAt5 = { cron: "0 5 * * *" };
const hourly = { cron: "0 * * * *" };

/** Three failures since a success on 06-06. */
const failingState: StatePatch = {
  lastRun: "2026-06-09T05:00:10Z", lastResult: "failure", lastError: "boom",
  lastSuccess: "2026-06-06T05:00:10Z", consecutiveFailures: 3,
};

/** A scheduler daemon that ticked 30s before NOW. */
const scheduler: SchedulerHeartbeat = { status: "running", lastTickAt: "2026-06-09T11:59:30Z", ageMs: 30_000 };

// ## Healthy task
//
// A daily 5am cron that last ran (and succeeded) this morning:
void test("A daily 5am cron that last ran (and succeeded) this morning:", async (t) => {
  t.check(statusOf({ fields: dailyAt5, state: ran("2026-06-09T05:00:10Z") }), "ok");
});

// ## Failing
//
// Any consecutive failure marks the task failing; the count and the
// last-success divergence ride along:
void test("Any consecutive failure marks the task failing; the count and the last-succes...", async (t) => {
  t.check(evaluate({ fields: dailyAt5, state: failingState }), {
    ...BASE,
    status: "failing",
    consecutiveFailures: 3,
    lastRun: "2026-06-09T05:00:10Z",
    lastSuccess: "2026-06-06T05:00:10Z",
    lastError: "boom",
  });
});

// A task that lost a race for the box's git index never got to run its own work.
// It still counts as failing — four in a row is worth hearing about — but the
// reason says what actually happened, so nobody debugs a task that is fine. An
// ordinary failure carries no such reason — the distinction is the point:
void test("A task that lost a race for the box's git index never got to run its own work.", async (t) => {
  const contended = evaluate({
    fields: dailyAt5,
    state: {
      lastRun: "2026-06-09T05:00:10Z", lastResult: "failure", consecutiveFailures: 4,
      lastError: "Command failed with exit code 1\nstderr:\nError: fatal: Unable to create '/box/.git/index.lock': File exists.",
    },
  });
  const ordinary = evaluate({
    fields: dailyAt5,
    state: { lastRun: "2026-06-09T05:00:10Z", lastResult: "failure", lastError: "boom", consecutiveFailures: 1 },
  });
  t.check(contended, {
    ...BASE,
    status: "failing",
    reason: "contended — another process held the box's git index",
    consecutiveFailures: 4,
    lastRun: "2026-06-09T05:00:10Z",
    lastSuccess: null,
    lastError: "Command failed with exit code 1\nstderr:\nError: fatal: Unable to create '/box/.git/index.lock': File exists.",
  });
  t.check(ordinary, {
    ...BASE,
    status: "failing",
    consecutiveFailures: 1,
    lastRun: "2026-06-09T05:00:10Z",
    lastSuccess: null,
    lastError: "boom",
  });
});

// The concise error shown by `bbx health` and proactive alerts prefers the precise
// child-process diagnostic over the generic command wrapper:
void test("The concise error shown by bbx health and proactive alerts prefers the precis...", async (t) => {
  t.check(
    conciseScheduleError(
      "Command failed with exit code 1\nstderr:\n" +
      "…older stderr chatter\n" +
      "Agent failed: intermediate symptom\n" +
      "Error: Procedure refresh-maps failed — Agent invocation failed: Model gpt-retired is not supported\n" +
      "stdout:\nProcedure failed",
    ),
    "Error: Procedure refresh-maps failed — Agent invocation failed: Model gpt-retired is not supported",
  );
});

// A timeout without a precise stderr diagnostic keeps its actionable headline
// instead of showing the last progress line:
void test("A timeout without a precise stderr diagnostic keeps its actionable headline i...", async (t) => {
  t.check(
    conciseScheduleError(
      "Command timed out after 1800000ms of awake runtime\n" +
      "stdout:\nStep: refresh-maps",
    ),
    "Command timed out after 1800000ms of awake runtime",
  );
});

// ## Overdue
//
// (Cron expressions evaluate in server-local time, same as `isDue` — the
// examples here use hourly crons, which mean the same thing in every
// timezone, so the test passes on any machine.)
//
// An hourly task last attempted two days ago has missed dozens of
// occurrences; pending time is measured from the earliest one:
void test("(Cron expressions evaluate in server-local time, same as isDue — the examples...", async (t) => {
  const h = evaluate({ fields: hourly, state: ran("2026-06-07T05:00:10Z") });
  t.check(h, {
    ...BASE,
    status: "overdue",
    pendingMs: 194_400_000,
    consecutiveFailures: 0,
    lastRun: "2026-06-07T05:00:10Z",
    lastSuccess: "2026-06-07T05:00:10Z",
    lastError: null,
  });
  // The health summary reads an overdue span as a duration (54 hours).
  t.check(formatDuration(h.pendingMs ?? 0), "2d 6h");
});

// But a task only a little past its occurrence is still within its allowance — an
// hourly task 40 minutes late (the allowance floor is 30m, half-cadence for an
// hourly task is 30m):
void test("But a task only a little past its occurrence is still within its allowance —...", async (t) => {
  const lastHour = ran("2026-06-09T10:00:10Z");
  t.check(statusOf({ fields: hourly, state: lastHour, now: new Date("2026-06-09T11:25:00Z") }), "ok");

  t.check(statusOf({ fields: hourly, state: lastHour, now: new Date("2026-06-09T11:45:00Z") }), "overdue");
});

// A never-attempted task measures from the card's mtime:
void test("A never-attempted task measures from the card's mtime:", async (t) => {
  t.check(statusOf({ fields: hourly, cardMtime: new Date("2026-06-05T00:00:00Z") }), "overdue");
});

// `not-before` postpones due-ness — an hourly cron with `not-before: 30m`
// that ran 35 minutes ago has an occurrence pending but well within its allowance:
void test("not-before postpones due-ness — an hourly cron with not-before:", async (t) => {
  t.check(statusOf({ fields: { ...hourly, "not-before": "30m" }, state: ran("2026-06-09T11:25:00Z") }), "ok");
});

// On-wakeup-only tasks have no intrinsic cadence and are never overdue:
void test("On-wakeup-only tasks have no intrinsic cadence and are never overdue:", async (t) => {
  t.check(statusOf({ fields: { "on-wakeup": true, "not-before": "5m" }, state: ran("2026-05-01T00:00:00Z") }), "ok");
});

// A one-shot `at` task unserved an hour past its time is overdue; once
// attempted it never re-triggers:
void test("A one-shot at task unserved an hour past its time is overdue; once attempted...", async (t) => {
  t.check(statusOf({ fields: { at: "2026-06-09T09:00:00Z" } }), "overdue");

  t.check(statusOf({ fields: { at: "2026-06-09T09:00:00Z" }, state: ran("2026-06-09T09:00:30Z") }), "ok");
});

// ## Deliberate skips are not failures
//
// Disabled and expired tasks are excluded; budget-exhausted and
// missing-connector tasks are blocked (with the reason), not overdue —
// even when occurrences have gone unserved:
void test("Disabled and expired tasks are excluded; budget-exhausted and missing-connect...", async (t) => {
  const overBudget = [{ ts: "2026-06-09T05:00:00Z", durationMs: 700_000 }];
  t.check(statusOf({ fields: { ...dailyAt5, enabled: false } }), "disabled");

  t.check(statusOf({ fields: { ...dailyAt5, until: "2026-06-01T00:00:00Z" } }), "disabled");

  const blocked = evaluate({
    fields: { ...dailyAt5, budget: "10m/24h" },
    state: { ...ran("2026-06-07T05:00:10Z"), recentRuns: overBudget },
  });
  t.check(blocked, {
    ...BASE,
    status: "blocked",
    reason: "budget exhausted (700s used)",
    consecutiveFailures: 0,
    lastRun: "2026-06-07T05:00:10Z",
    lastSuccess: "2026-06-07T05:00:10Z",
    lastError: null,
  });

  const noConn = evaluate({
    fields: { ...dailyAt5, requires: { connectors: ["gmail"] } },
    missingConnectors: ["gmail"],
  });
  t.check(noConn, {
    ...BASE,
    status: "blocked",
    reason: "missing connectors: gmail",
    consecutiveFailures: 0,
    lastRun: null,
    lastSuccess: null,
    lastError: null,
  });
});

// A failing task whose failures exhausted the budget reports as failing
// (the cause), with the blockage as the reason:
void test("A failing task whose failures exhausted the budget reports as failing (the ca...", async (t) => {
  const h = evaluate({
    fields: { ...dailyAt5, budget: "10m/24h" },
    state: {
      lastRun: "2026-06-09T05:00:10Z", lastResult: "failure", lastError: "timeout",
      consecutiveFailures: 2,
      recentRuns: [{ ts: "2026-06-09T05:00:00Z", durationMs: 700_000 }],
    },
  });
  t.check(h, {
    ...BASE,
    status: "failing",
    reason: "budget exhausted (700s used)",
    consecutiveFailures: 2,
    lastRun: "2026-06-09T05:00:10Z",
    lastSuccess: null,
    lastError: "timeout",
  });
});

// ## Summaries and alert selection
//
// The summary speaks only when something is wrong, and folds overdue
// findings into a scheduler-down finding when the daemon's heartbeat is
// stale (suppressing them entirely when no daemon ever ran — dev boxes):
void test("The summary speaks only when something is wrong, and folds overdue findings i...", async (t) => {
  const failing = evaluate({ fields: dailyAt5, state: failingState });
  const overdue = evaluate({ fields: hourly, state: ran("2026-06-07T05:00:10Z") });
  const ok = evaluate({ fields: dailyAt5, state: ran("2026-06-09T05:00:10Z") });

  t.check(summarizeScheduleHealth({ tasks: [ok], scheduler, engineWait: null }, NOW), null);

  t.check(
    summarizeScheduleHealth({ tasks: [failing, overdue, ok], scheduler, engineWait: null }, NOW),
    "demo: failing ×3 (last success 3d ago); demo: overdue 2d 6h",
  );

  t.check(
    summarizeScheduleHealth({
      tasks: [failing, overdue, ok],
      scheduler: { status: "stale", lastTickAt: "2026-06-09T04:00:00Z", ageMs: 28_800_000 },
      engineWait: null,
    }, NOW),
    "scheduler not running (last tick 8h ago); demo: failing ×3 (last success 3d ago)",
  );

  t.check(
    summarizeScheduleHealth({
      tasks: [overdue, ok],
      scheduler: { status: "never", lastTickAt: null, ageMs: null },
      engineWait: null,
    }, NOW),
    null,
  );

  // Proactive alerts need two consecutive failures (one transient failure
  // self-heals at the next occurrence); overdue and invalid alert directly:

  const oneFailure = evaluate({
    fields: dailyAt5,
    state: { lastRun: "2026-06-09T05:00:10Z", lastResult: "failure", lastError: "boom", consecutiveFailures: 1 },
  });
  t.check(selectAlertableTasks({ tasks: [oneFailure], scheduler, engineWait: null }), []);
  t.check(selectAlertableTasks({ tasks: [failing], scheduler, engineWait: null }), [failing]);
  t.check(selectAlertableTasks({ tasks: [overdue], scheduler, engineWait: null }), [overdue]);
  t.check(selectAlertableTasks({ tasks: [ok], scheduler, engineWait: null }), []);
});

// ## Waiting — engine unavailable is deferred, not unhealthy
//
// When the box's engine is out of quota (deferred-recoverable), every
// enabled task renders `waiting` — including one that would otherwise be
// `failing` or `overdue`. The system deferred the work; the task is not
// broken, and the trust rule says never to mislabel a deliberate skip.
// `disabled` still wins: an off task is off, whatever the engine's state.
void test("When the box's engine is out of quota (deferred-recoverable), every enabled t...", async (t) => {
  const reason = "waiting on codex quota until Aug 19, 11:34 PM";
  const waitingFailing = evaluate({ fields: dailyAt5, state: failingState, engineWaitReason: reason });
  t.check(waitingFailing, {
    ...BASE,
    status: "waiting",
    reason: "waiting on codex quota until Aug 19, 11:34 PM",
    consecutiveFailures: 3,
    lastRun: "2026-06-09T05:00:10Z",
    lastSuccess: "2026-06-06T05:00:10Z",
    lastError: "boom",
  });

  t.check(statusOf({ fields: { ...dailyAt5, enabled: false }, engineWaitReason: reason }), "disabled");

  // The waiting state is neither summarized as unhealthy nor alertable —
  // the episode itself is the one box-level line the summary leads with:

  t.check(summarizeScheduleHealth({ tasks: [waitingFailing], scheduler, engineWait: reason }, NOW), "waiting on codex quota until Aug 19, 11:34 PM");

  t.check(selectAlertableTasks({ tasks: [waitingFailing], scheduler, engineWait: reason }), []);
});

// ## Inconclusive — the work ran, the check never decided
//
// A run that exits with the inconclusive marker records `lastResult:
// "inconclusive"`. That is not a failure: `consecutiveFailures` stays where it
// was, so the task reads `inconclusive`, not `failing ×1`. It is not a success
// either — `lastSuccess` is untouched, because an unjudged run is not a
// confirmed one.
void test("A run that exits with the inconclusive marker records lastResult:", async (t) => {
  const h = evaluate({
    fields: dailyAt5,
    state: {
      lastRun: "2026-06-09T05:00:10Z",
      lastResult: "inconclusive",
      lastError:
        "Command failed with exit code 2\nstderr:\n" +
        "Inconclusive: procedure refresh-maps — review of step maps reached max turns (16); work completed",
      lastSuccess: "2026-06-06T05:00:10Z",
      consecutiveFailures: 0,
    },
  });
  t.check(h, {
    ...BASE,
    status: "inconclusive",
    reason: "last run's check reached no verdict; the work itself completed",
    consecutiveFailures: 0,
    lastRun: "2026-06-09T05:00:10Z",
    lastSuccess: "2026-06-06T05:00:10Z",
    lastError:
      "Command failed with exit code 2\nstderr:\n" +
      "Inconclusive: procedure refresh-maps — review of step maps reached max turns (16); work completed",
  });

  // A live problem outranks the stale non-answer: a task that has failed since, or
  // gone overdue, or is out of budget, reports that instead.

  t.check(
    statusOf({
      fields: dailyAt5,
      state: {
        lastRun: "2026-06-09T05:00:10Z", lastResult: "inconclusive",
        lastSuccess: "2026-06-06T05:00:10Z", consecutiveFailures: 2,
      },
    }),
    "failing",
  );
  t.check(
    statusOf({
      fields: { ...dailyAt5, enabled: false },
      state: { lastRun: "2026-06-09T05:00:10Z", lastResult: "inconclusive" },
    }),
    "disabled",
  );

  // It speaks in the session-start summary but never pages the boxholder — nothing
  // is wrong yet:

  t.check(
    summarizeScheduleHealth({ tasks: [h], scheduler, engineWait: null }, NOW),
    "demo: review inconclusive (work completed, unjudged)",
  );
  t.check(selectAlertableTasks({ tasks: [h], scheduler, engineWait: null }), []);
});

// The inconclusive line is the headline `bbx health` prints for that error — it is
// the only line that says the work completed, so it wins over
// `Command failed with exit code 2`:
void test("The inconclusive line is the headline bbx health prints for that error — it i...", async (t) => {
  t.check(
    conciseScheduleError(
      "Command failed with exit code 2\nstderr:\n" +
      "Inconclusive: procedure refresh-maps — review of step maps reached max turns (16); work completed\n" +
      "stdout:\nAll MAP.md files current.",
    ),
    "Inconclusive: procedure refresh-maps — review of step maps reached max turns (16); work completed",
  );
});
