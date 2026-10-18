// # Scheduled Scripts
//
// Parsing, scheduling, and budget utilities for scheduled script cards. Scripts define what to run and when — evaluated by `bbx tick` (cron) and `bbx wakeup` (on-wakeup).

import { test } from "tap";
import "agent-doctest/tap";
import {
  parseDuration,
  parseBudget,
  parseScheduledScript,
  createScheduledScriptTemplate,
  ScheduledScriptSchema,
  type ParsedScheduledScript,
} from "../../src/schemas/scheduled-script/schema.js";
import { isDue, isDueForWakeup, isWithinBudget } from "../../src/schemas/scheduled-script/due.js";

function baseCardFields(overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    type: "scheduled-script",
    runs: "echo test",
    ...overrides,
  };
}

function makeScript(overrides: Partial<ParsedScheduledScript>): ParsedScheduledScript {
  return {
    cron: undefined,
    at: undefined,
    rrule: undefined,
    until: undefined,
    notBefore: undefined,
    onWakeup: false,
    once: false,
    enabled: true,
    action: { kind: "runs", command: "echo test" },
    requestedBy: undefined,
    description: undefined,
    reason: undefined,
    createAfterSuccess: [],
    budget: undefined,
    lockGroup: undefined,
    timeoutMs: undefined,
    requires: undefined,
    ...overrides,
  };
}

// ## parseDuration
//
// Parses human-readable duration strings into milliseconds. Supports `s` (seconds), `m` (minutes), `h` (hours), `d` (days), and fractional values.
void test("Parses human-readable duration strings into milliseconds.", async (t) => {
  // doctest:L53
  t.check(parseDuration("30s"), 30000);

  // doctest:L56
  t.check(parseDuration("5m"), 300000);

  // doctest:L59
  t.check(parseDuration("4h"), 14400000);

  // doctest:L62
  t.check(parseDuration("1d"), 86400000);

  // doctest:L65
  t.check(parseDuration("1.5h"), 5400000);
});

// ## parseBudget
//
// Parses budget strings in the format `limit/window` — both are durations. A budget of `10m/5h` means "at most 10 minutes of runtime within any 5-hour window."
void test("Parses budget strings in the format limit/window — both are durations.", async (t) => {
  // doctest:L74
  t.check(parseBudget("10m/5h"), {
    limitMs: 600000,
    windowMs: 18000000,
  });
});

// ## parseScheduledScript: timeout
//
// The optional `timeout` field caps a single run's awake runtime, as a duration
// string. It parses to `timeoutMs`; when absent, the runner falls back to the
// default `SCRIPT_TIMEOUT` (10 minutes).
void test("The optional timeout field caps a single run's awake runtime, as a duration s...", async (t) => {
  // doctest:L85
  t.check(parseScheduledScript({ type: "scheduled-script", runs: "echo hi", timeout: "25m" }).timeoutMs, 1500000);

  // doctest:L88
  t.check(parseScheduledScript({ type: "scheduled-script", runs: "echo hi" }).timeoutMs, undefined);
});

// ## Schema: `at`/`until` must be parseable datetimes
//
// A malformed date used to pass validation and then silently never fire at
// runtime (see issues/bugs/2026-08-10-invalid-schedule-dates-silently-inert.md).
// Now it's a card validation error.
void test("A malformed date used to pass validation and then silently never fire at runt...", async (t) => {
  // doctest:L99
  t.check(ScheduledScriptSchema.frontmatterSchema.safeParse(baseCardFields({ until: "not-a-date" })).success, false);

  // doctest:L102
  t.check(ScheduledScriptSchema.frontmatterSchema.safeParse(baseCardFields({ at: "2026-09-01T14:30:00Z" })).success, true);

  // doctest:L105
  t.check(ScheduledScriptSchema.frontmatterSchema.safeParse(baseCardFields({ until: "2026-09-01T14:30:00Z" })).success, true);
});

// `new Date()` alone would accept strings like "5" (May 2001) or "0" (Jan
// 2000) — the ISO-shape requirement rejects those:
void test("new Date() alone would accept strings like \"5\" (May 2001) or \"0\" (Jan 2000) —...", async (t) => {
  // doctest:L113
  t.check(ScheduledScriptSchema.frontmatterSchema.safeParse(baseCardFields({ at: "5" })).success, false);

  // doctest:L116
  t.check(ScheduledScriptSchema.frontmatterSchema.safeParse(baseCardFields({ until: "2026-13-45" })).success, false);

  // doctest:L119
  t.check(ScheduledScriptSchema.frontmatterSchema.safeParse(baseCardFields({ until: "2026-12-31" })).success, true);
});

// The error names the expected form:
void test("The error names the expected form:", async (t) => {
  // doctest:L126
  const badAt = ScheduledScriptSchema.frontmatterSchema.safeParse(baseCardFields({ at: "not-a-date" }));
  t.check(badAt.success ? undefined : badAt.error.issues[0]?.message, "must be an ISO 8601 datetime (e.g. 2026-09-01T14:30:00)");
});

// ## Schema: `cron` must be a valid cron expression
void test("Schema: `cron` must be a valid cron expression", async (t) => {
  // doctest:L134
  t.check(ScheduledScriptSchema.frontmatterSchema.safeParse(baseCardFields({ cron: "0 6 * * *" })).success, true);

  // doctest:L137
  const badCron = ScheduledScriptSchema.frontmatterSchema.safeParse(baseCardFields({ cron: "not a cron" }));
  t.check(badCron.success ? undefined : badCron.error.issues[0]?.message, "invalid cron expression");
});

// ## Schema: `rrule` must be a valid RRULE
void test("Schema: `rrule` must be a valid RRULE", async (t) => {
  // doctest:L145
  t.check(
    ScheduledScriptSchema.frontmatterSchema.safeParse(
      baseCardFields({ rrule: "FREQ=WEEKLY;BYDAY=MO" })
    ).success,
    true,
  );

  // doctest:L150
  const badRrule = ScheduledScriptSchema.frontmatterSchema.safeParse(baseCardFields({ rrule: "not an rrule" }));
  t.check(badRrule.success ? undefined : badRrule.error.issues[0]?.message, "invalid RRULE");
});

// ## Schema: cron/at/rrule are mutually exclusive
void test("Schema: cron/at/rrule are mutually exclusive", async (t) => {
  // doctest:L158
  t.check(
    ScheduledScriptSchema.frontmatterSchema.safeParse(
      baseCardFields({ cron: "0 6 * * *", at: "2026-09-01T14:30:00Z" })
    ).success,
    false,
  );
});

// ## Schema: exactly one of `runs` and `notify`
//
// A reminder carries `notify:` in place of `runs:`. A card with both, or with
// neither, fails validation with a message that names the rule.
void test("A reminder carries notify: in place of runs:.", async (t) => {
  // doctest:L170
  const issues = (fields: Record<string, unknown>) => {
    const parsed = ScheduledScriptSchema.frontmatterSchema.safeParse({ type: "scheduled-script", ...fields });
    return parsed.success ? "valid" : parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("\n");
  };
  t.check(issues({ at: "2026-10-02T08:30", notify: { title: "Call the vet" } }), "valid");

  // doctest:L177
  t.check(issues({ at: "2026-10-02T08:30", runs: "echo hi", notify: { title: "Call the vet" } }), "notify: a scheduled script needs exactly one of runs (a command) and notify (a notification)");

  // doctest:L180
  t.check(issues({ at: "2026-10-02T08:30" }), "runs: a scheduled script needs exactly one of runs (a command) and notify (a notification)");

  // `notify` fields are checked where they are written: the target parses as a
  // notification target, the context is a card path inside the box, the loudness
  // is one of the three, `requested-by` is only `boxholder`, and an unknown key is
  // refused rather than ignored.

  // doctest:L190
  t.check(
    issues({ at: "2026-10-02T08:30", notify: { title: "x", target: "https://example.com" } })
    ,
    "notify.target: Invalid notification target \"https://example.com\": unknown scheme \"https\". Valid targets: chat:<sessionId>, chat:new, card:<path>, question:<path>, admin:<section>, dashboard",
  );

  // doctest:L193
  t.check(issues({ at: "2026-10-02T08:30", notify: { title: "x", context: "../outside.todo.card" } }), "notify.context: must be a card path inside the box (e.g. _content/pets/pepper-shots.todo.card)");

  // doctest:L196
  await t.checkText(issues({ at: "2026-10-02T08:30", notify: { title: "x", loudness: "shout" } }).startsWith("notify.loudness:"), "true");

  // doctest:L199
  t.check(issues({ at: "2026-10-02T08:30", notify: { title: " " } }), "notify.title: a notification needs a title");

  // doctest:L202
  await t.checkText(issues({ at: "2026-10-02T08:30", notify: { title: "x", sound: "chime" } }).startsWith("notify: "), "true");

  // doctest:L205
  await t.checkText(issues({ at: "2026-10-02T08:30", notify: { title: "x" }, "requested-by": "agent" }).startsWith("requested-by:"), "true");

  // `parseScheduledScript` turns the pair into one `action`:

  // doctest:L212
  t.check(parseScheduledScript({ type: "scheduled-script", at: "2026-10-02T08:30", "requested-by": "boxholder", notify: { title: "Call the vet" } }).action, {
    kind: "notify",
    notify: {
      title: "Call the vet",
    },
  });

  // doctest:L215
  t.check(parseScheduledScript({ type: "scheduled-script", runs: "echo hi" }).action, {
    kind: "runs",
    command: "echo hi",
  });
});

// ## isDue
//
// Determines if a scheduled script should run based on its schedule type (cron, at, rrule), enabled state, until deadline, and not-before debouncing.
//
// A cron script that has never run is due:
void test("Determines if a scheduled script should run based on its schedule type (cron,...", async (t) => {
  // doctest:L226
  t.check(isDue(makeScript({ cron: "0 * * * *" }), { lastRun: null, now: new Date("2026-02-21T10:30:00Z") }), true);
});

// A cron script is due when the last run was before the most recent scheduled time:
void test("A cron script is due when the last run was before the most recent scheduled t...", async (t) => {
  // doctest:L233
  t.check(isDue(makeScript({ cron: "0 * * * *" }), { lastRun: "2026-02-21T09:05:00Z", now: new Date("2026-02-21T10:30:00Z") }), true);
});

// Not due if we already ran after the most recent scheduled time:
void test("Not due if we already ran after the most recent scheduled time:", async (t) => {
  // doctest:L240
  t.check(isDue(makeScript({ cron: "0 * * * *" }), { lastRun: "2026-02-21T10:05:00Z", now: new Date("2026-02-21T10:30:00Z") }), false);
});

// An `at` script fires once when its time passes:
void test("An at script fires once when its time passes:", async (t) => {
  // doctest:L247
  t.check(isDue(makeScript({ at: "2026-02-21T09:00:00Z" }), { lastRun: null, now: new Date("2026-02-21T10:00:00Z") }), true);

  // doctest:L250
  t.check(isDue(makeScript({ at: "2026-02-21T09:00:00Z" }), { lastRun: "2026-02-21T09:01:00Z", now: new Date("2026-02-21T10:00:00Z") }), false);

  // doctest:L253
  t.check(isDue(makeScript({ at: "2026-02-21T12:00:00Z" }), { lastRun: null, now: new Date("2026-02-21T10:00:00Z") }), false);
});

// Disabled and expired scripts are never due:
void test("Disabled and expired scripts are never due:", async (t) => {
  // doctest:L260
  t.check(isDue(makeScript({ cron: "* * * * *", enabled: false }), { lastRun: null, now: new Date("2026-02-21T10:00:00Z") }), false);

  // doctest:L263
  t.check(isDue(makeScript({ cron: "* * * * *", until: "2026-01-01T00:00:00Z" }), { lastRun: null, now: new Date("2026-02-21T10:00:00Z") }), false);
});

// The `not-before` attribute debounces — prevents running again too soon:
void test("The not-before attribute debounces — prevents running again too soon:", async (t) => {
  // doctest:L270
  t.check(isDue(makeScript({ cron: "* * * * *", notBefore: "1h" }), { lastRun: "2026-02-21T09:30:00Z", now: new Date("2026-02-21T10:00:00Z") }), false);

  // doctest:L273
  t.check(isDue(makeScript({ cron: "* * * * *", notBefore: "1h" }), { lastRun: "2026-02-21T08:30:00Z", now: new Date("2026-02-21T10:00:00Z") }), true);
});

// A wakeup-only script (no cron/at/rrule) is due for tick if `onWakeup` is set:
void test("A wakeup-only script (no cron/at/rrule) is due for tick if onWakeup is set:", async (t) => {
  // doctest:L280
  t.check(isDue(makeScript({ onWakeup: true }), { lastRun: null, now: new Date("2026-02-21T10:00:00Z") }), true);

  // doctest:L283
  t.check(isDue(makeScript({ onWakeup: false }), { lastRun: null, now: new Date("2026-02-21T10:00:00Z") }), false);
});

// ## isDueForWakeup
//
// Checks if a script should run during `bbx wakeup` — only applies to `onWakeup: true` scripts, and respects not-before and enabled/until constraints.
void test("Checks if a script should run during bbx wakeup — only applies to onWakeup:", async (t) => {
  // doctest:L292
  t.check(isDueForWakeup(makeScript({ onWakeup: true, notBefore: "5m" }), { lastRun: "2026-02-21T09:00:00Z", now: new Date("2026-02-21T10:00:00Z") }), true);

  // doctest:L295
  t.check(isDueForWakeup(makeScript({ onWakeup: true, notBefore: "5m" }), { lastRun: "2026-02-21T09:58:00Z", now: new Date("2026-02-21T10:00:00Z") }), false);

  // doctest:L298
  t.check(isDueForWakeup(makeScript({ cron: "0 * * * *", onWakeup: false }), { lastRun: null, now: new Date("2026-02-21T10:00:00Z") }), false);

  // doctest:L301
  t.check(isDueForWakeup(makeScript({ onWakeup: true, notBefore: "5m" }), { lastRun: null, now: new Date("2026-02-21T10:00:00Z") }), true);

  // doctest:L304
  t.check(isDueForWakeup(makeScript({ onWakeup: true, until: "2026-01-01T00:00:00Z" }), { lastRun: null, now: new Date("2026-02-21T10:00:00Z") }), false);

  // doctest:L307
  t.check(isDueForWakeup(makeScript({ onWakeup: true, enabled: false }), { lastRun: null, now: new Date("2026-02-21T10:00:00Z") }), false);
});

// ## isWithinBudget
//
// Checks runtime budget — sums run durations within the budget window. Returns `{ allowed, usedMs }`. Durations are awake runtime (measured sleep-free by exec-with-timeout), so the `sleepAffected` flag is informational and does not exclude a run.
//
// No recent runs — always allowed:
void test("Checks runtime budget — sums run durations within the budget window.", async (t) => {
  // doctest:L318
  t.check(isWithinBudget({ limitMs: 600_000, windowMs: 18_000_000 }, { recentRuns: [], now: new Date("2026-02-21T10:00:00Z") }), {
    allowed: true,
    usedMs: 0,
  });
});

// Under budget:
void test("Under budget:", async (t) => {
  // doctest:L325
  t.check(isWithinBudget({ limitMs: 600_000, windowMs: 18_000_000 }, { recentRuns: [{ ts: "2026-02-21T09:00:00Z", durationMs: 300_000 }], now: new Date("2026-02-21T10:00:00Z") }), {
    allowed: true,
    usedMs: 300000,
  });
});

// Over budget:
void test("Over budget:", async (t) => {
  // doctest:L332
  t.check(isWithinBudget({ limitMs: 600_000, windowMs: 18_000_000 }, { recentRuns: [{ ts: "2026-02-21T08:00:00Z", durationMs: 300_000 }, { ts: "2026-02-21T09:00:00Z", durationMs: 400_000 }], now: new Date("2026-02-21T10:00:00Z") }), {
    allowed: false,
    usedMs: 700000,
  });
});

// Sleep-affected runs count like any other — their recorded duration is already awake-only:
void test("Sleep-affected runs count like any other — their recorded duration is already...", async (t) => {
  // doctest:L339
  t.check(isWithinBudget({ limitMs: 700_000, windowMs: 18_000_000 }, { recentRuns: [{ ts: "2026-02-21T09:00:00Z", durationMs: 500_000, sleepAffected: true }, { ts: "2026-02-21T09:30:00Z", durationMs: 100_000 }], now: new Date("2026-02-21T10:00:00Z") }), {
    allowed: true,
    usedMs: 600000,
  });
});

// Runs outside the window are also ignored:
void test("Runs outside the window are also ignored:", async (t) => {
  // doctest:L346
  t.check(isWithinBudget({ limitMs: 600_000, windowMs: 3_600_000 }, { recentRuns: [{ ts: "2026-02-21T08:00:00Z", durationMs: 500_000 }, { ts: "2026-02-21T09:30:00Z", durationMs: 100_000 }], now: new Date("2026-02-21T10:00:00Z") }), {
    allowed: true,
    usedMs: 100000,
  });
});

// ## createScheduledScriptTemplate
//
// Generates YAML frontmatter for scheduled-script cards:
void test("Generates YAML frontmatter for scheduled-script cards:", async (t) => {
  // doctest:L355
  await t.checkText(
    createScheduledScriptTemplate({
      cron: "0 6 * * *",
      notBefore: "4h",
      onWakeup: true,
      runs: "bbx wakeup --connector rss",
      reason: "Check RSS feeds",
    }),
    `---
cron: 0 6 * * *
not-before: 4h
on-wakeup: true
runs: bbx wakeup --connector rss
reason: Check RSS feeds
---`,
  );
});

// A one-shot script with `at` and `once`:
void test("A one-shot script with at and once:", async (t) => {
  // doctest:L376
  await t.checkText(
    createScheduledScriptTemplate({
      at: "2026-03-01T09:00:00Z",
      once: true,
      runs: "scripts/remind.sh",
    }),
    `---
at: 2026-03-01T09:00:00Z
once: true
runs: scripts/remind.sh
---`,
  );
});

// The template is validated against the schema before it's returned — a
// programmatic caller fails fast instead of writing a card that can't load:
void test("The template is validated against the schema before it's returned — a program...", async (t) => {
  // doctest:L394
  await t.checkThrows(async () => (createScheduledScriptTemplate({ cron: "not a cron", runs: "echo hi" })), "InvalidScheduledScriptTemplateError");

  // doctest:L397
  await t.checkThrows(
    async () => (createScheduledScriptTemplate({
      cron: "0 6 * * *",
      at: "2026-03-01T09:00:00Z",
      runs: "echo hi",
    })),
    "InvalidScheduledScriptTemplateError",
  );
});
