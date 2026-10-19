// # `todo-model.ts` — status enum, date parsing, plate-state derivation
//
// Pure-function doctests for the shared todo vocabulary
// (`docs/implemented-plans/todo-annotation.md`, Track 1 chunk 1): the closed status enum,
// absolute/relative date parsing, attribute validation, and the box-local
// plate-state truth table.

import { test } from "tap";
import "agent-doctest/tap";
import assert from "node:assert/strict";
import {
  isTodoStatus,
  parseIsoDate,
  parseRelativeStart,
  resolveStartEpoch,
  validateTodoAttributes,
  recheckDefers,
  deriveTodoPlateState,
  type TodoPlateInput,
} from "../../src/shared/todo-model.js";

function plate(input: TodoPlateInput, { now, timeZone }: { now: string; timeZone: string }): string {
  return deriveTodoPlateState(input, { now: new Date(now), timeZone });
}

function noAttrs(overrides: Partial<Parameters<typeof validateTodoAttributes>[0]>) {
  return { by: undefined, created: undefined, due: undefined, start: undefined, recheck: undefined, ...overrides };
}

// ## Status enum
void test("Status enum", async (t) => {
  // doctest:L38
  t.check(isTodoStatus("open"), true);

  // doctest:L41
  t.check(isTodoStatus("wontfix"), false);

  // doctest:L44
  t.check(isTodoStatus("Open"), false);
});

// ## Absolute date parsing
//
// Valid calendar dates parse to a UTC-midnight epoch; malformed shapes and
// non-existent calendar dates (Feb 30, month 13) are rejected.
void test("Valid calendar dates parse to a UTC-midnight epoch; malformed shapes and non-...", async (t) => {
  // doctest:L54
  t.check(parseIsoDate("2026-08-01"), 1785542400000);

  // doctest:L57
  t.check(parseIsoDate("2026-02-30"), null);

  // doctest:L60
  t.check(parseIsoDate("2026-13-01"), null);

  // doctest:L63
  t.check(parseIsoDate("08/01/2026"), null);

  // doctest:L66
  t.check(parseIsoDate("2026-8-1"), null);
});

// ## Relative `start` parsing
void test("Relative `start` parsing", async (t) => {
  // doctest:L73
  t.check(parseRelativeStart("-3d"), {
    amount: 3,
    unit: "d",
  });

  // doctest:L77
  t.check(parseRelativeStart("-2w"), {
    amount: 2,
    unit: "w",
  });

  // doctest:L81
  t.check(parseRelativeStart("2026-08-01"), null);

  // doctest:L84
  t.check(parseRelativeStart("-3m"), null);

  // doctest:L87
  t.check(parseRelativeStart("3d"), null);
});

// ## Resolving `start` (absolute or relative) against `due`
void test("Resolving `start` (absolute or relative) against `due`", async (t) => {
  // doctest:L94
  t.check(resolveStartEpoch("2026-08-01", undefined), 1785542400000);

  // doctest:L97
  t.check(resolveStartEpoch("-3d", "2026-08-01"), parseIsoDate("2026-07-29"));

  // doctest:L100
  t.check(resolveStartEpoch("-2w", "2026-08-01"), parseIsoDate("2026-07-18"));

  // doctest:L103
  t.check(resolveStartEpoch("-3d", undefined), null);

  // doctest:L106
  t.check(resolveStartEpoch("not-a-date", "2026-08-01"), null);
});

// ## Attribute validation
void test("Attribute validation", async (t) => {
  // doctest:L113
  t.check(validateTodoAttributes(noAttrs({})), []);

  // doctest:L117
  t.check(validateTodoAttributes(noAttrs({ created: "2026-07-28", due: "2026-08-01", start: "-3d" })), []);
});

// ### Invalid dates
void test("Invalid dates", async (t) => {
  // doctest:L125
  t.check(validateTodoAttributes(noAttrs({ created: "2026-02-30" })), [
    {
      id: "todo-invalid-created",
      message: "{% todo %} `created` is not a valid ISO date: \"2026-02-30\"",
    },
  ]);

  // doctest:L129
  t.check(validateTodoAttributes(noAttrs({ due: "not-a-date" })), [
    {
      id: "todo-invalid-due",
      message: "{% todo %} `due` is not a valid ISO date: \"not-a-date\"",
    },
  ]);

  // doctest:L133
  t.check(validateTodoAttributes(noAttrs({ start: "next tuesday" })), [
    {
      id: "todo-invalid-start",
      message: "{% todo %} `start` is not a valid ISO date or relative interval (e.g. \"-3d\"): \"next tuesday\"",
    },
  ]);
});

// ### Relative `start` requires `due`
void test("Relative `start` requires `due`", async (t) => {
  // doctest:L141
  t.check(validateTodoAttributes(noAttrs({ start: "-3d" })), [
    {
      id: "todo-relative-start-requires-due",
      message: "{% todo %} a relative `start` (\"-3d\") requires `due` to be set",
    },
  ]);
});

// ### `start` after `due` (both absolute) is an error
void test("`start` after `due` (both absolute) is an error", async (t) => {
  // doctest:L149
  t.check(validateTodoAttributes(noAttrs({ due: "2026-08-01", start: "2026-08-05" })), [
    {
      id: "todo-start-after-due",
      message: "{% todo %} `start` (\"2026-08-05\") is after `due` (\"2026-08-01\")",
    },
  ]);
});

// A relative `start` can never land after `due` by construction (it's always
// `due` minus a non-negative interval), so this rule only fires for two
// absolute dates.
//
// ### `created` required when `by="agent"`
void test("A relative start can never land after due by construction (it's always due mi...", async (t) => {
  // doctest:L161
  t.check(validateTodoAttributes(noAttrs({ by: "agent" })), [
    {
      id: "todo-agent-requires-created",
      message: "{% todo %} `created` is required when `by=\"agent\"`",
    },
  ]);

  // doctest:L165
  t.check(validateTodoAttributes(noAttrs({ by: "agent", created: "2026-07-28" })), []);

  // doctest:L169
  t.check(validateTodoAttributes(noAttrs({ by: "Dana" })), []);
});

// ### `recheck` is a date or `never`
//
// `recheck` is the todo-review's bookkeeping (`docs/plans/todos-ui.md`, Track
// 7): the date the review may next list the todo, or `never`. Anything else is
// a validation error that says both accepted forms.
void test("recheck is the todo-review's bookkeeping (docs/plans/todos-ui.md, Track 7):", async (t) => {
  // doctest:L181
  t.check(validateTodoAttributes(noAttrs({ recheck: "2026-10-15" })), []);

  // doctest:L185
  t.check(validateTodoAttributes(noAttrs({ recheck: "never" })), []);

  // doctest:L189
  t.check(validateTodoAttributes(noAttrs({ recheck: "next month" })), [
    {
      id: "todo-invalid-recheck",
      message: "{% todo %} `recheck` must be an ISO date (YYYY-MM-DD) or \"never\": \"next month\"",
    },
  ]);

  // doctest:L193
  t.check(validateTodoAttributes(noAttrs({ recheck: "Never" })), [
    {
      id: "todo-invalid-recheck",
      message: "{% todo %} `recheck` must be an ISO date (YYYY-MM-DD) or \"never\": \"Never\"",
    },
  ]);
});

// The sweep skips a todo whose `recheck` is `never` or still ahead of today;
// on the day itself, or after it, the todo is back in review. A malformed value
// defers nothing (validation is what reports it).
void test("The sweep skips a todo whose recheck is never or still ahead of today; on the...", async (t) => {
  // doctest:L202
  const today = parseIsoDate("2026-09-25");
  assert.ok(today !== null);
  t.check(["2026-09-26", "2026-09-25", "2026-09-01", "never", undefined, "soon"].map((r) => recheckDefers(r, today)), [
    true,
    false,
    false,
    true,
    false,
    false,
  ]);
});

// ## Plate-state derivation
//
// Frozen `now` values, box-local timezone. An `open` todo with neither `start`
// nor `due` is on the plate immediately (undated = now, per Goal 2 — never a
// silent graveyard).
void test("Frozen now values, box-local timezone.", async (t) => {
  // doctest:L215
  t.check(plate({ status: "open" }, { now: "2026-07-28T12:00:00Z", timeZone: "America/Chicago" }), "on-plate");

  // doctest:L219
  t.check(plate({ status: "open", due: "2026-08-01" }, { now: "2026-07-28T12:00:00Z", timeZone: "America/Chicago" }), "on-plate");

  // doctest:L223
  t.check(plate({ status: "open", due: "2026-07-01" }, { now: "2026-07-28T12:00:00Z", timeZone: "America/Chicago" }), "escalated");

  // doctest:L227
  t.check(plate({ status: "open", start: "2026-08-01" }, { now: "2026-07-28T12:00:00Z", timeZone: "America/Chicago" }), "quiet");

  // doctest:L231
  t.check(plate({ status: "open", start: "2026-07-01" }, { now: "2026-07-28T12:00:00Z", timeZone: "America/Chicago" }), "on-plate");

  // doctest:L235
  t.check(plate({ status: "open", start: "-3d", due: "2026-08-01" }, { now: "2026-07-27T12:00:00Z", timeZone: "America/Chicago" }), "quiet");

  // doctest:L239
  t.check(plate({ status: "open", start: "-3d", due: "2026-08-01" }, { now: "2026-07-30T12:00:00Z", timeZone: "America/Chicago" }), "on-plate");
});

// ## Non-open statuses are their own terminal plate states
void test("Non-open statuses are their own terminal plate states", async (t) => {
  // doctest:L247
  t.check(plate({ status: "done", due: "2026-01-01" }, { now: "2026-07-28T12:00:00Z", timeZone: "America/Chicago" }), "done");
});

// ## Timezone boundary: box-local date, not UTC
//
// `2026-07-28T23:30:00-05:00` is `2026-07-29T04:30:00Z` in UTC, but still
// `2026-07-28` in `America/Chicago`. A todo with `due: "2026-07-28"` reads as
// due-today (still on-plate, not escalated) in the box's own timezone at that
// instant, even though a bare UTC-date comparison would already call it
// tomorrow.
//
// `2026-07-29T04:30:00Z` is `2026-07-28 23:30` in `America/Chicago`.
void test("2026-07-28T23:30:00-05:00 is 2026-07-29T04:30:00Z in UTC, but still 2026-07-2...", async (t) => {
  // doctest:L263
  const nearMidnightLocal = "2026-07-29T04:30:00Z";

  // doctest:L265
  t.check(plate({ status: "open", due: "2026-07-28" }, { now: nearMidnightLocal, timeZone: "America/Chicago" }), "on-plate");

  // The same instant, read in UTC (where the calendar date has already rolled
  // to the 29th), is past that same `due` — escalated:

  // doctest:L274
  t.check(plate({ status: "open", due: "2026-07-28" }, { now: nearMidnightLocal, timeZone: "UTC" }), "escalated");

  // A `start` boundary shows the same effect: local Chicago time is still
  // `2026-07-28`, before an `America/Chicago`-local `start` of `2026-07-29` —
  // still quiet there — while UTC already reads `2026-07-29`, on the plate.

  // doctest:L284
  t.check(plate({ status: "open", start: "2026-07-29" }, { now: nearMidnightLocal, timeZone: "America/Chicago" }), "quiet");

  // doctest:L288
  t.check(plate({ status: "open", start: "2026-07-29" }, { now: nearMidnightLocal, timeZone: "UTC" }), "on-plate");
});
