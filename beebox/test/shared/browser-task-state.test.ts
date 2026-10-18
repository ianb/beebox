// # Browser-task lifecycle state
//
// `browserTaskState` turns a task card's fields into the state the view and the
// dashboard show: closed, never scanned, scanned (no cadence), current, or due.
// The caller supplies the clock.

import { test } from "tap";
import "agent-doctest/tap";
import { browserTaskState, describeBrowserTaskState } from "../../src/shared/browser-task-state.js";
import { parseIso8601DurationMs, isIso8601Duration } from "../../src/shared/iso-duration.js";

const now = Date.parse("2026-09-13T12:00:00Z");
const day = 86_400_000;
const state = (input: { closed?: unknown; lastUpload?: unknown; rescanAfter?: unknown }) =>
  browserTaskState({ closed: input.closed, lastUpload: input.lastUpload, rescanAfter: input.rescanAfter }, now);

// ## The five states
void test("The five states", async (t) => {
  // doctest:L20
  t.check(state({ closed: true, lastUpload: "2026-09-01T00:00:00Z", rescanAfter: "P1D" }), {
    kind: "closed",
  });

  // doctest:L23
  t.check(state({}), {
    kind: "never-scanned",
  });

  // doctest:L26
  t.check(state({ lastUpload: "2026-09-01T00:00:00Z" }), {
    kind: "scanned",
    lastAt: "2026-09-01T00:00:00Z",
  });

  // doctest:L29
  t.check(state({ lastUpload: "2026-09-12T00:00:00Z", rescanAfter: "P14D" }), {
    kind: "current",
    lastAt: "2026-09-12T00:00:00Z",
    dueAt: "2026-09-26T00:00:00.000Z",
  });

  // doctest:L32
  const due = state({ lastUpload: "2026-09-01T00:00:00Z", rescanAfter: "P1W" });
  t.check(due.kind === "due" ? [due.dueAt, Math.round(due.overdueMs / day)] : due, [
    "2026-09-08T00:00:00.000Z",
    6,
  ]);
});

// A malformed timestamp or cadence reads as absent rather than throwing:
void test("A malformed timestamp or cadence reads as absent rather than throwing:", async (t) => {
  // doctest:L40
  t.check([state({ lastUpload: "yesterday" }).kind, state({ lastUpload: "2026-09-01T00:00:00Z", rescanAfter: "fortnightly" }).kind], [
    "never-scanned",
    "scanned",
  ]);
});

// ## One line each
void test("One line each", async (t) => {
  // doctest:L47
  t.check(
    [
      describeBrowserTaskState(state({ closed: true })),
      describeBrowserTaskState(state({})),
      describeBrowserTaskState(state({ lastUpload: "2026-09-01T00:00:00Z" })),
      describeBrowserTaskState(state({ lastUpload: "2026-09-12T00:00:00Z", rescanAfter: "P14D" })),
      describeBrowserTaskState(state({ lastUpload: "2026-09-01T00:00:00Z", rescanAfter: "P1W" })),
      describeBrowserTaskState(state({ lastUpload: "2026-09-13T00:00:00Z", rescanAfter: "PT1H" })),
    ],
    [
    "closed",
    "never scanned",
    "scanned, no cadence set",
    "current, next due 2026-09-26",
    "due, 5 days overdue",
    "due today",
  ],
  );
});

// ## The duration grammar, now shared
//
// The parser moved out of the question schema so the browser can use it too;
// the question schema re-exports it.
void test("The parser moved out of the question schema so the browser can use it too; th...", async (t) => {
  // doctest:L64
  t.check([parseIso8601DurationMs("P1W") / day, parseIso8601DurationMs("PT12H") / day, isIso8601Duration("P"), isIso8601Duration("P2W")], [
    7,
    0.5,
    false,
    true,
  ]);
});
