/**
 * Tests for the scheduled-script system.
 */

import { test } from "tap";
import {
  parseDuration,
  isDue,
  isDueForWakeup,
  createScheduledScriptTemplate,
  type ParsedScheduledScript,
  type ScheduleCheckContext,
} from "../src/schemas/scheduled-script.js";

// ============================================
// parseDuration
// ============================================

test("parseDuration: parses seconds", async (t) => {
  t.equal(parseDuration("30s"), 30_000);
});

test("parseDuration: parses minutes", async (t) => {
  t.equal(parseDuration("5m"), 5 * 60 * 1000);
});

test("parseDuration: parses hours", async (t) => {
  t.equal(parseDuration("4h"), 4 * 60 * 60 * 1000);
});

test("parseDuration: parses days", async (t) => {
  t.equal(parseDuration("1d"), 24 * 60 * 60 * 1000);
});

test("parseDuration: parses fractional values", async (t) => {
  t.equal(parseDuration("1.5h"), 1.5 * 60 * 60 * 1000);
});

test("parseDuration: throws on invalid input", async (t) => {
  t.throws(() => parseDuration("abc"));
  t.throws(() => parseDuration("10"));
  t.throws(() => parseDuration(""));
  t.throws(() => parseDuration("5x"));
});

// ============================================
// isDue — cron
// ============================================

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
    runs: "echo test",
    source: undefined,
    ...overrides,
  };
}

test("isDue: cron script is due when never run", async (t) => {
  const script = makeScript({ cron: "0 * * * *" }); // every hour
  const ctx: ScheduleCheckContext = {
    lastRun: null,
    now: new Date("2026-02-21T10:30:00Z"),
  };
  t.ok(isDue(script, ctx));
});

test("isDue: cron script is due when last run was before the most recent scheduled time", async (t) => {
  const script = makeScript({ cron: "0 * * * *" }); // every hour
  const ctx: ScheduleCheckContext = {
    lastRun: "2026-02-21T09:05:00Z",
    now: new Date("2026-02-21T10:30:00Z"),
  };
  t.ok(isDue(script, ctx));
});

test("isDue: cron script is not due when last run was after the most recent scheduled time", async (t) => {
  const script = makeScript({ cron: "0 * * * *" }); // every hour
  const ctx: ScheduleCheckContext = {
    lastRun: "2026-02-21T10:05:00Z",
    now: new Date("2026-02-21T10:30:00Z"),
  };
  t.notOk(isDue(script, ctx));
});

// ============================================
// isDue — at
// ============================================

test("isDue: at script is due when time has passed and never run", async (t) => {
  const script = makeScript({ at: "2026-02-21T09:00:00Z" });
  const ctx: ScheduleCheckContext = {
    lastRun: null,
    now: new Date("2026-02-21T10:00:00Z"),
  };
  t.ok(isDue(script, ctx));
});

test("isDue: at script is not due when already run", async (t) => {
  const script = makeScript({ at: "2026-02-21T09:00:00Z" });
  const ctx: ScheduleCheckContext = {
    lastRun: "2026-02-21T09:01:00Z",
    now: new Date("2026-02-21T10:00:00Z"),
  };
  t.notOk(isDue(script, ctx));
});

test("isDue: at script is not due when time hasn't arrived", async (t) => {
  const script = makeScript({ at: "2026-02-21T12:00:00Z" });
  const ctx: ScheduleCheckContext = {
    lastRun: null,
    now: new Date("2026-02-21T10:00:00Z"),
  };
  t.notOk(isDue(script, ctx));
});

// ============================================
// isDue — disabled / until / not-before
// ============================================

test("isDue: disabled script is never due", async (t) => {
  const script = makeScript({ cron: "* * * * *", enabled: false });
  const ctx: ScheduleCheckContext = {
    lastRun: null,
    now: new Date("2026-02-21T10:00:00Z"),
  };
  t.notOk(isDue(script, ctx));
});

test("isDue: expired (until) script is never due", async (t) => {
  const script = makeScript({ cron: "* * * * *", until: "2026-01-01T00:00:00Z" });
  const ctx: ScheduleCheckContext = {
    lastRun: null,
    now: new Date("2026-02-21T10:00:00Z"),
  };
  t.notOk(isDue(script, ctx));
});

test("isDue: not-before prevents running too soon", async (t) => {
  const script = makeScript({ cron: "* * * * *", notBefore: "1h" });
  const ctx: ScheduleCheckContext = {
    lastRun: "2026-02-21T09:30:00Z",
    now: new Date("2026-02-21T10:00:00Z"),
  };
  // Only 30 min elapsed, not-before is 1h
  t.notOk(isDue(script, ctx));
});

test("isDue: not-before allows running after enough time", async (t) => {
  const script = makeScript({ cron: "* * * * *", notBefore: "1h" });
  const ctx: ScheduleCheckContext = {
    lastRun: "2026-02-21T08:30:00Z",
    now: new Date("2026-02-21T10:00:00Z"),
  };
  // 1.5h elapsed, not-before is 1h
  t.ok(isDue(script, ctx));
});

test("isDue: wakeup-only script (no cron/at/rrule) is not due for tick", async (t) => {
  const script = makeScript({ onWakeup: true });
  const ctx: ScheduleCheckContext = {
    lastRun: null,
    now: new Date("2026-02-21T10:00:00Z"),
  };
  t.notOk(isDue(script, ctx));
});

// ============================================
// isDueForWakeup
// ============================================

test("isDueForWakeup: returns true for on-wakeup script when not-before is satisfied", async (t) => {
  const script = makeScript({ onWakeup: true, notBefore: "5m" });
  const ctx: ScheduleCheckContext = {
    lastRun: "2026-02-21T09:00:00Z",
    now: new Date("2026-02-21T10:00:00Z"),
  };
  t.ok(isDueForWakeup(script, ctx));
});

test("isDueForWakeup: returns false when not-before hasn't elapsed", async (t) => {
  const script = makeScript({ onWakeup: true, notBefore: "5m" });
  const ctx: ScheduleCheckContext = {
    lastRun: "2026-02-21T09:58:00Z",
    now: new Date("2026-02-21T10:00:00Z"),
  };
  t.notOk(isDueForWakeup(script, ctx));
});

test("isDueForWakeup: returns false for non-wakeup scripts", async (t) => {
  const script = makeScript({ cron: "0 * * * *", onWakeup: false });
  const ctx: ScheduleCheckContext = {
    lastRun: null,
    now: new Date("2026-02-21T10:00:00Z"),
  };
  t.notOk(isDueForWakeup(script, ctx));
});

test("isDueForWakeup: returns true when never run", async (t) => {
  const script = makeScript({ onWakeup: true, notBefore: "5m" });
  const ctx: ScheduleCheckContext = {
    lastRun: null,
    now: new Date("2026-02-21T10:00:00Z"),
  };
  t.ok(isDueForWakeup(script, ctx));
});

test("isDueForWakeup: respects until", async (t) => {
  const script = makeScript({
    onWakeup: true,
    until: "2026-01-01T00:00:00Z",
  });
  const ctx: ScheduleCheckContext = {
    lastRun: null,
    now: new Date("2026-02-21T10:00:00Z"),
  };
  t.notOk(isDueForWakeup(script, ctx));
});

test("isDueForWakeup: respects disabled", async (t) => {
  const script = makeScript({ onWakeup: true, enabled: false });
  const ctx: ScheduleCheckContext = {
    lastRun: null,
    now: new Date("2026-02-21T10:00:00Z"),
  };
  t.notOk(isDueForWakeup(script, ctx));
});

// ============================================
// createScheduledScriptTemplate
// ============================================

test("createScheduledScriptTemplate: cron with on-wakeup", async (t) => {
  const template = createScheduledScriptTemplate({
    cron: "0 6 * * *",
    notBefore: "4h",
    onWakeup: true,
    runs: "cb wakeup --connector rss",
    source: "Check RSS feeds",
  });
  t.ok(template.includes('cron="0 6 * * *"'));
  t.ok(template.includes('not-before="4h"'));
  t.ok(template.includes('on-wakeup="true"'));
  t.ok(template.includes("<runs>cb wakeup --connector rss</runs>"));
  t.ok(template.includes("<source>Check RSS feeds</source>"));
});

test("createScheduledScriptTemplate: at with once", async (t) => {
  const template = createScheduledScriptTemplate({
    at: "2026-03-01T09:00:00Z",
    once: true,
    runs: "scripts/remind.sh",
  });
  t.ok(template.includes('at="2026-03-01T09:00:00Z"'));
  t.ok(template.includes('once="true"'));
  t.notOk(template.includes("source"));
});

test("createScheduledScriptTemplate: source with ref", async (t) => {
  const template = createScheduledScriptTemplate({
    cron: "0 * * * *",
    runs: "echo hi",
    source: "Calendar deadline",
    sourceRef: "store/calendar/event.ics",
  });
  t.ok(template.includes('ref="store/calendar/event.ics"'));
  t.ok(template.includes("Calendar deadline</source>"));
});

test("createScheduledScriptTemplate: minimal (wakeup only)", async (t) => {
  const template = createScheduledScriptTemplate({
    onWakeup: true,
    runs: "cb wakeup --connector capture",
  });
  t.ok(template.includes('on-wakeup="true"'));
  t.notOk(template.includes("cron"));
  t.notOk(template.includes("at="));
});
