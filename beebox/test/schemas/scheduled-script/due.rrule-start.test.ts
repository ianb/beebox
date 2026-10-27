// # An RRULE without DTSTART fires once per occurrence
//
// rrule takes the parse time as the start of a rule with no DTSTART, and the
// scheduler parses on every check, so `FREQ=WEEKLY;BYDAY=MO` had a fresh
// occurrence "now" on every tick of a Monday
// (issues/closed/bugs/2026-10-27-rrule-without-dtstart-is-due-on-every-tick.md).
// Such a rule now starts at midnight UTC of the last run's day (today for a
// card that has never run), so its occurrences are midnight UTC on matching
// days, a new card waits for its first matching day, and a multi-line rule
// (EXDATE) gets the same start. A rule with its own DTSTART is unchanged.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import type { ParsedScheduledScript } from "../../../src/schemas/scheduled-script/schema.js";
import { isDue } from "../../../src/schemas/scheduled-script/due.js";

function weekly(rrule: string): ParsedScheduledScript {
  return {
    cron: undefined, at: undefined, rrule, until: undefined,
    notBefore: undefined, onWakeup: false, once: false, enabled: true,
    action: { kind: "runs", command: "echo hi" }, requestedBy: undefined, description: undefined, reason: undefined,
    createAfterSuccess: [], budget: undefined, lockGroup: undefined,
    timeoutMs: undefined, requires: undefined,
  };
}

function due(script: ParsedScheduledScript, { lastRun, now }: { lastRun: string | null; now: string }): boolean {
  return isDue(script, { lastRun, lastResult: lastRun === null ? null : "success", consecutiveFailures: 0, lastFailureFinal: false, now: new Date(now) });
}

// 2026-10-26 is a Monday.
const monday = weekly("FREQ=WEEKLY;BYDAY=MO");

void test("a weekly rule without DTSTART is due once on its day, at midnight UTC", async (t) => {
  t.check(
    {
      firstTickOfMonday: due(monday, { lastRun: "2026-10-19T00:00:30Z", now: "2026-10-26T00:01:00Z" }),
      laterTickSameMonday: due(monday, { lastRun: "2026-10-26T00:01:00Z", now: "2026-10-26T14:00:00Z" }),
      tuesday: due(monday, { lastRun: "2026-10-26T00:01:00Z", now: "2026-10-27T09:00:00Z" }),
      nextMonday: due(monday, { lastRun: "2026-10-26T00:01:00Z", now: "2026-11-02T00:00:10Z" }),
      neverRunTuesday: due(monday, { lastRun: null, now: "2026-10-27T09:00:00Z" }),
      neverRunMonday: due(monday, { lastRun: null, now: "2026-11-02T09:00:00Z" }),
    },
    { firstTickOfMonday: true, laterTickSameMonday: false, tuesday: false, nextMonday: true, neverRunTuesday: false, neverRunMonday: true },
  );
});

void test("a rule with its own DTSTART keeps its time of day", async (t) => {
  const mondayAt8 = weekly("DTSTART:20261005T080000Z\nRRULE:FREQ=WEEKLY;BYDAY=MO");
  t.check(
    {
      beforeEight: due(mondayAt8, { lastRun: "2026-10-19T08:00:05Z", now: "2026-10-26T07:59:00Z" }),
      atEight: due(mondayAt8, { lastRun: "2026-10-19T08:00:05Z", now: "2026-10-26T08:00:30Z" }),
      laterSameDay: due(mondayAt8, { lastRun: "2026-10-26T08:00:30Z", now: "2026-10-26T20:00:00Z" }),
    },
    { beforeEight: false, atEight: true, laterSameDay: false },
  );
});

void test("a rule with an EXDATE line gets the same start, and the EXDATE skips that Monday", async (t) => {
  // A blank line between the two is ignored, as rrulestr ignores it.
  const skipNov2 = weekly("RRULE:FREQ=WEEKLY;BYDAY=MO\n\nEXDATE:20261102T000000Z");
  t.check(
    {
      laterTickSameMonday: due(skipNov2, { lastRun: "2026-10-26T00:01:00Z", now: "2026-10-26T14:00:00Z" }),
      skippedMonday: due(skipNov2, { lastRun: "2026-10-26T00:01:00Z", now: "2026-11-02T12:00:00Z" }),
      followingMonday: due(skipNov2, { lastRun: "2026-10-26T00:01:00Z", now: "2026-11-09T00:00:10Z" }),
    },
    { laterTickSameMonday: false, skippedMonday: false, followingMonday: true },
  );
});
