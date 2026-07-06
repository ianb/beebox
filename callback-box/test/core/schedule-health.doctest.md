# Scheduled-task health

`evaluateTaskHealth` classifies a scheduled task from its card + run
state: `ok`, `failing`, `overdue`, `blocked`, `invalid`, or `disabled`.
The trust rule: a deliberate skip (budget, missing connector, disabled)
must never be reported as overdue or failing.

```ts setup
import { evaluateTaskHealth, findMissedOccurrence } from "../../src/core/schedule/health.js";
import { parseScheduledScript } from "../../src/schemas/scheduled-script.js";
import { normalizeScriptState } from "../../src/core/schedule/state.js";
import {
  summarizeScheduleHealth,
  selectAlertableTasks,
  formatDurationShort,
} from "../../src/core/schedule/health-box.js";

const NOW = new Date("2026-06-09T12:00:00Z");

function makeScript(fields = {}) {
  return parseScheduledScript({ type: "scheduled-script", runs: "true", ...fields });
}

function evaluate({ fields = {}, state = {}, now = NOW, cardMtime = new Date("2026-06-01T00:00:00Z"), missingConnectors = [] } = {}) {
  return evaluateTaskHealth({
    name: "demo",
    parsed: makeScript(fields),
    state: normalizeScriptState(state),
    now,
    cardMtime,
    missingConnectors,
  });
}
```

## Healthy task

A daily 5am cron that last ran (and succeeded) this morning:

```ts
const h = evaluate({
  fields: { cron: "0 5 * * *" },
  state: { lastRun: "2026-06-09T05:00:10Z", lastResult: "success" },
});
h.status
=> ok
```

## Failing

Any consecutive failure marks the task failing; the count and the
last-success divergence ride along:

```ts
const h = evaluate({
  fields: { cron: "0 5 * * *" },
  state: {
    lastRun: "2026-06-09T05:00:10Z", lastResult: "failure", lastError: "boom",
    lastSuccess: "2026-06-06T05:00:10Z", consecutiveFailures: 3,
  },
});
print(`${h.status}, failures: ${h.consecutiveFailures}, lastSuccess: ${h.lastSuccess}`);
=> failing, failures: 3, lastSuccess: 2026-06-06T05:00:10Z
```

## Overdue

(Cron expressions evaluate in server-local time, same as `isDue` — the
examples here use hourly crons, which mean the same thing in every
timezone, so the doctest passes on any machine.)

An hourly task last attempted two days ago has missed dozens of
occurrences; pending time is measured from the earliest one:

```ts
const h = evaluate({
  fields: { cron: "0 * * * *" },
  state: { lastRun: "2026-06-07T05:00:10Z", lastResult: "success", lastSuccess: "2026-06-07T05:00:10Z" },
});
print(`${h.status}, pending: ${formatDurationShort(h.pendingMs)}`);
=> overdue, pending: 2d
```

But a task only a little past its occurrence is still within grace — an
hourly task 40 minutes late (grace floor is 30m, half-cadence for an
hourly task is 30m):

```ts
evaluate({
  fields: { cron: "0 * * * *" },
  state: { lastRun: "2026-06-09T10:00:10Z", lastResult: "success", lastSuccess: "2026-06-09T10:00:10Z" },
  now: new Date("2026-06-09T11:25:00Z"),
}).status
=> ok

evaluate({
  fields: { cron: "0 * * * *" },
  state: { lastRun: "2026-06-09T10:00:10Z", lastResult: "success", lastSuccess: "2026-06-09T10:00:10Z" },
  now: new Date("2026-06-09T11:45:00Z"),
}).status
=> overdue
```

A never-attempted task measures from the card's mtime:

```ts
evaluate({
  fields: { cron: "0 * * * *" },
  cardMtime: new Date("2026-06-05T00:00:00Z"),
}).status
=> overdue
```

`not-before` postpones due-ness — an hourly cron with `not-before: 30m`
that ran 35 minutes ago has an occurrence pending but well within grace:

```ts
evaluate({
  fields: { cron: "0 * * * *", "not-before": "30m" },
  state: { lastRun: "2026-06-09T11:25:00Z", lastResult: "success", lastSuccess: "2026-06-09T11:25:00Z" },
}).status
=> ok
```

On-wakeup-only tasks have no intrinsic cadence and are never overdue:

```ts
evaluate({
  fields: { "on-wakeup": true, "not-before": "5m" },
  state: { lastRun: "2026-05-01T00:00:00Z", lastResult: "success", lastSuccess: "2026-05-01T00:00:00Z" },
}).status
=> ok
```

A one-shot `at` task unserved an hour past its time is overdue; once
attempted it never re-triggers:

```ts
evaluate({ fields: { at: "2026-06-09T09:00:00Z" } }).status
=> overdue

evaluate({
  fields: { at: "2026-06-09T09:00:00Z" },
  state: { lastRun: "2026-06-09T09:00:30Z", lastResult: "success", lastSuccess: "2026-06-09T09:00:30Z" },
}).status
=> ok
```

## Deliberate skips are not failures

Disabled and expired tasks are excluded; budget-exhausted and
missing-connector tasks are blocked (with the reason), not overdue —
even when occurrences have gone unserved:

```ts
evaluate({ fields: { cron: "0 5 * * *", enabled: false } }).status
=> disabled

evaluate({ fields: { cron: "0 5 * * *", until: "2026-06-01T00:00:00Z" } }).status
=> disabled

const blocked = evaluate({
  fields: { cron: "0 5 * * *", budget: "10m/24h" },
  state: {
    lastRun: "2026-06-07T05:00:10Z", lastResult: "success", lastSuccess: "2026-06-07T05:00:10Z",
    recentRuns: [{ ts: "2026-06-09T05:00:00Z", durationMs: 700_000 }],
  },
});
print(`${blocked.status}: ${blocked.reason}`);
=> blocked: budget exhausted (700s used)

const noConn = evaluate({
  fields: { cron: "0 5 * * *", requires: { connectors: ["gmail"] } },
  missingConnectors: ["gmail"],
});
print(`${noConn.status}: ${noConn.reason}`);
=> blocked: missing connectors: gmail
```

A failing task whose failures exhausted the budget reports as failing
(the cause), with the blockage as the reason:

```ts
const h = evaluate({
  fields: { cron: "0 5 * * *", budget: "10m/24h" },
  state: {
    lastRun: "2026-06-09T05:00:10Z", lastResult: "failure", lastError: "timeout",
    consecutiveFailures: 2,
    recentRuns: [{ ts: "2026-06-09T05:00:00Z", durationMs: 700_000 }],
  },
});
print(`${h.status}: ${h.reason}`);
=> failing: budget exhausted (700s used)
```

## Summaries and alert selection

The summary speaks only when something is wrong, and folds overdue
findings into a scheduler-down finding when the daemon's heartbeat is
stale (suppressing them entirely when no daemon ever ran — dev boxes):

```ts
const failing = evaluate({
  fields: { cron: "0 5 * * *" },
  state: {
    lastRun: "2026-06-09T05:00:10Z", lastResult: "failure", lastError: "boom",
    lastSuccess: "2026-06-06T05:00:10Z", consecutiveFailures: 3,
  },
});
const overdue = evaluate({
  fields: { cron: "0 * * * *" },
  state: { lastRun: "2026-06-07T05:00:10Z", lastResult: "success", lastSuccess: "2026-06-07T05:00:10Z" },
});
const ok = evaluate({
  fields: { cron: "0 5 * * *" },
  state: { lastRun: "2026-06-09T05:00:10Z", lastResult: "success", lastSuccess: "2026-06-09T05:00:10Z" },
});

summarizeScheduleHealth({
  tasks: [ok],
  scheduler: { status: "running", lastTickAt: "2026-06-09T11:59:30Z", ageMs: 30_000 },
}, NOW)
=> null

summarizeScheduleHealth({
  tasks: [failing, overdue, ok],
  scheduler: { status: "running", lastTickAt: "2026-06-09T11:59:30Z", ageMs: 30_000 },
}, NOW)
=> demo: failing ×3 (last success 3d ago); demo: overdue 2d

summarizeScheduleHealth({
  tasks: [failing, overdue, ok],
  scheduler: { status: "stale", lastTickAt: "2026-06-09T04:00:00Z", ageMs: 28_800_000 },
}, NOW)
=> scheduler not running (last tick 8h ago); demo: failing ×3 (last success 3d ago)

summarizeScheduleHealth({
  tasks: [overdue, ok],
  scheduler: { status: "never", lastTickAt: null, ageMs: null },
}, NOW)
=> null
```

Proactive alerts need two consecutive failures (one transient failure
self-heals at the next occurrence); overdue and invalid alert directly:

```ts continue
const oneFailure = evaluate({
  fields: { cron: "0 5 * * *" },
  state: { lastRun: "2026-06-09T05:00:10Z", lastResult: "failure", lastError: "boom", consecutiveFailures: 1 },
});
const scheduler = { status: "running", lastTickAt: "2026-06-09T11:59:30Z", ageMs: 30_000 };
print(`one failure: ${selectAlertableTasks({ tasks: [oneFailure], scheduler }).length}`);
print(`three failures: ${selectAlertableTasks({ tasks: [failing], scheduler }).length}`);
print(`overdue: ${selectAlertableTasks({ tasks: [overdue], scheduler }).length}`);
print(`ok: ${selectAlertableTasks({ tasks: [ok], scheduler }).length}`);
=>
one failure: 0
three failures: 1
overdue: 1
ok: 0
```
