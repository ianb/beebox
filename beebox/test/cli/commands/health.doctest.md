# `bbx health` text output

`bbx health` prints the scheduled-task section, then the box checks. The
`scheduled-tasks` box check restates the task section for the dashboard, so
the CLI leaves it out and a failing task appears once. A task whose last run
found nothing to do reads `ok: <reason>`; one held back reads
`waiting: <reason>`.

```ts setup
import { formatHealthText } from "../../../src/cli/commands/health.js";
import { scheduledTasksCheck } from "../../../src/webapp/trpc/routers/health/checks/schedules.js";

const now = new Date("2026-09-26T12:00:00Z");
const hourAgo = "2026-09-26T11:00:00Z";
const task = (fields) => ({
  description: undefined, lastRun: hourAgo, lastSuccess: hourAgo, consecutiveFailures: 0,
  lastError: null, alertedAt: null, alertedFor: null, ...fields,
});
const health = {
  scheduler: { status: "running", lastTickAt: now.toISOString(), ageMs: 60_000 },
  engineWait: null,
  tasks: [
    task({ name: "sync-notes", status: "failing", consecutiveFailures: 3, lastSuccess: null, lastError: "Agent invocation failed: model retired" }),
    task({ name: "watch-trip", status: "ok", deferReason: "no-change", reason: "nothing to do" }),
    task({ name: "watch-quote", status: "waiting", deferReason: "budget", reason: "the box used its daily Jev budget" }),
  ],
};
```

```ts
const boxChecks = [
  scheduledTasksCheck(health, now),
  { name: "inbox-writable", ok: true, message: "ok", severity: "error" },
  { name: "google-auth", ok: false, message: "Google needs reconnecting", severity: "warning" },
];
formatHealthText(health, { boxChecks, now, all: false, running: new Map() })
=>
  ✗ sync-notes             failing ×3     last attempt 1h ago, never succeeded
      error: Agent invocation failed: model retired
  ✓ watch-trip             ok: nothing to do last success 1h ago
  ◷ watch-quote            waiting: the box used its daily Jev budget last success 1h ago
  scheduler: running (last tick 1m ago)
«blankline»
Box checks:
  ! google-auth            Google needs reconnecting
  (1 other checks pass)
```

The check is still there for the dashboard, naming the same task.

```ts continue
boxChecks[0].ok
=> false

boxChecks[0].message.includes("sync-notes")
=> true
```
