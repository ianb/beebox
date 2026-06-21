# Scheduled Scripts

Parsing, scheduling, and budget utilities for scheduled script cards. Scripts define what to run and when — evaluated by `cb tick` (cron) and `cb wakeup` (on-wakeup).

```ts setup
import {
  parseDuration,
  parseBudget,
  parseScheduledScript,
  isDue,
  isDueForWakeup,
  isWithinBudget,
  createScheduledScriptTemplate,
} from "../src/schemas/scheduled-script.js";

function makeScript(overrides) {
  return {
    cron: undefined,
    at: undefined,
    rrule: undefined,
    until: undefined,
    notBefore: undefined,
    onWakeup: false,
    once: false,
    enabled: true,
    runs: "echo test",
    source: undefined,
    budget: undefined,
    ...overrides,
  };
}
```

## parseDuration

Parses human-readable duration strings into milliseconds. Supports `s` (seconds), `m` (minutes), `h` (hours), `d` (days), and fractional values.

```ts
parseDuration("30s")
=> 30000

parseDuration("5m")
=> 300000

parseDuration("4h")
=> 14400000

parseDuration("1d")
=> 86400000

parseDuration("1.5h")
=> 5400000
```

## parseBudget

Parses budget strings in the format `limit/window` — both are durations. A budget of `10m/5h` means "at most 10 minutes of runtime within any 5-hour window."

```ts
JSON.stringify(parseBudget("10m/5h"))
=> {"limitMs":600000,"windowMs":18000000}

JSON.stringify(parseBudget("30s/1m"))
=> {"limitMs":30000,"windowMs":60000}
```

## parseScheduledScript: timeout

The optional `timeout` field caps a single run's awake runtime, as a duration
string. It parses to `timeoutMs`; when absent, the runner falls back to the
default `SCRIPT_TIMEOUT` (10 minutes).

```ts
parseScheduledScript({ type: "scheduled-script", runs: "echo hi", timeout: "25m" }).timeoutMs
=> 1500000

parseScheduledScript({ type: "scheduled-script", runs: "echo hi" }).timeoutMs
=> undefined
```

## isDue

Determines if a scheduled script should run based on its schedule type (cron, at, rrule), enabled state, until deadline, and not-before debouncing.

A cron script that has never run is due:

```ts
isDue(makeScript({ cron: "0 * * * *" }), { lastRun: null, now: new Date("2026-02-21T10:30:00Z") })
=> true
```

A cron script is due when the last run was before the most recent scheduled time:

```ts
isDue(makeScript({ cron: "0 * * * *" }), { lastRun: "2026-02-21T09:05:00Z", now: new Date("2026-02-21T10:30:00Z") })
=> true
```

Not due if we already ran after the most recent scheduled time:

```ts
isDue(makeScript({ cron: "0 * * * *" }), { lastRun: "2026-02-21T10:05:00Z", now: new Date("2026-02-21T10:30:00Z") })
=> false
```

An `at` script fires once when its time passes:

```ts
isDue(makeScript({ at: "2026-02-21T09:00:00Z" }), { lastRun: null, now: new Date("2026-02-21T10:00:00Z") })
=> true

isDue(makeScript({ at: "2026-02-21T09:00:00Z" }), { lastRun: "2026-02-21T09:01:00Z", now: new Date("2026-02-21T10:00:00Z") })
=> false

isDue(makeScript({ at: "2026-02-21T12:00:00Z" }), { lastRun: null, now: new Date("2026-02-21T10:00:00Z") })
=> false
```

Disabled and expired scripts are never due:

```ts
isDue(makeScript({ cron: "* * * * *", enabled: false }), { lastRun: null, now: new Date("2026-02-21T10:00:00Z") })
=> false

isDue(makeScript({ cron: "* * * * *", until: "2026-01-01T00:00:00Z" }), { lastRun: null, now: new Date("2026-02-21T10:00:00Z") })
=> false
```

The `not-before` attribute debounces — prevents running again too soon:

```ts
isDue(makeScript({ cron: "* * * * *", notBefore: "1h" }), { lastRun: "2026-02-21T09:30:00Z", now: new Date("2026-02-21T10:00:00Z") })
=> false

isDue(makeScript({ cron: "* * * * *", notBefore: "1h" }), { lastRun: "2026-02-21T08:30:00Z", now: new Date("2026-02-21T10:00:00Z") })
=> true
```

A wakeup-only script (no cron/at/rrule) is due for tick if `onWakeup` is set:

```ts
isDue(makeScript({ onWakeup: true }), { lastRun: null, now: new Date("2026-02-21T10:00:00Z") })
=> true

isDue(makeScript({ onWakeup: false }), { lastRun: null, now: new Date("2026-02-21T10:00:00Z") })
=> false
```

## isDueForWakeup

Checks if a script should run during `cb wakeup` — only applies to `onWakeup: true` scripts, and respects not-before and enabled/until constraints.

```ts
isDueForWakeup(makeScript({ onWakeup: true, notBefore: "5m" }), { lastRun: "2026-02-21T09:00:00Z", now: new Date("2026-02-21T10:00:00Z") })
=> true

isDueForWakeup(makeScript({ onWakeup: true, notBefore: "5m" }), { lastRun: "2026-02-21T09:58:00Z", now: new Date("2026-02-21T10:00:00Z") })
=> false

isDueForWakeup(makeScript({ cron: "0 * * * *", onWakeup: false }), { lastRun: null, now: new Date("2026-02-21T10:00:00Z") })
=> false

isDueForWakeup(makeScript({ onWakeup: true, notBefore: "5m" }), { lastRun: null, now: new Date("2026-02-21T10:00:00Z") })
=> true

isDueForWakeup(makeScript({ onWakeup: true, until: "2026-01-01T00:00:00Z" }), { lastRun: null, now: new Date("2026-02-21T10:00:00Z") })
=> false

isDueForWakeup(makeScript({ onWakeup: true, enabled: false }), { lastRun: null, now: new Date("2026-02-21T10:00:00Z") })
=> false
```

## isWithinBudget

Checks runtime budget — sums run durations within the budget window. Returns `{ allowed, usedMs }`. Durations are awake runtime (measured sleep-free by exec-with-timeout), so the `sleepAffected` flag is informational and does not exclude a run.

No recent runs — always allowed:

```ts
JSON.stringify(isWithinBudget({ limitMs: 600_000, windowMs: 18_000_000 }, { recentRuns: [], now: new Date("2026-02-21T10:00:00Z") }))
=> {"allowed":true,"usedMs":0}
```

Under budget:

```ts
JSON.stringify(isWithinBudget({ limitMs: 600_000, windowMs: 18_000_000 }, { recentRuns: [{ ts: "2026-02-21T09:00:00Z", durationMs: 300_000 }], now: new Date("2026-02-21T10:00:00Z") }))
=> {"allowed":true,"usedMs":300000}
```

Over budget:

```ts
JSON.stringify(isWithinBudget({ limitMs: 600_000, windowMs: 18_000_000 }, { recentRuns: [{ ts: "2026-02-21T08:00:00Z", durationMs: 300_000 }, { ts: "2026-02-21T09:00:00Z", durationMs: 400_000 }], now: new Date("2026-02-21T10:00:00Z") }))
=> {"allowed":false,"usedMs":700000}
```

Sleep-affected runs count like any other — their recorded duration is already awake-only:

```ts
JSON.stringify(isWithinBudget({ limitMs: 700_000, windowMs: 18_000_000 }, { recentRuns: [{ ts: "2026-02-21T09:00:00Z", durationMs: 500_000, sleepAffected: true }, { ts: "2026-02-21T09:30:00Z", durationMs: 100_000 }], now: new Date("2026-02-21T10:00:00Z") }))
=> {"allowed":true,"usedMs":600000}
```

Runs outside the window are also ignored:

```ts
JSON.stringify(isWithinBudget({ limitMs: 600_000, windowMs: 3_600_000 }, { recentRuns: [{ ts: "2026-02-21T08:00:00Z", durationMs: 500_000 }, { ts: "2026-02-21T09:30:00Z", durationMs: 100_000 }], now: new Date("2026-02-21T10:00:00Z") }))
=> {"allowed":true,"usedMs":100000}
```

## createScheduledScriptTemplate

Generates YAML frontmatter for scheduled-script cards:

```ts
createScheduledScriptTemplate({
  cron: "0 6 * * *",
  notBefore: "4h",
  onWakeup: true,
  runs: "cb wakeup --connector rss",
  source: "Check RSS feeds",
})
=>
---
cron: 0 6 * * *
not-before: 4h
on-wakeup: true
runs: cb wakeup --connector rss
source: Check RSS feeds
---

```

A one-shot script with `at` and `once`:

```ts
createScheduledScriptTemplate({
  at: "2026-03-01T09:00:00Z",
  once: true,
  runs: "scripts/remind.sh",
})
=>
---
at: 2026-03-01T09:00:00Z
once: true
runs: scripts/remind.sh
---

```

Minimal wakeup-only script:

```ts
createScheduledScriptTemplate({
  onWakeup: true,
  runs: "cb wakeup --connector capture",
})
=>
---
on-wakeup: true
runs: cb wakeup --connector capture
---

```
