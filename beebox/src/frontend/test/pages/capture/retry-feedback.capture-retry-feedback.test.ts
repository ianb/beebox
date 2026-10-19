// # Retry feedback in the capture overlay
//
// Tapping Retry on failed uploads used to produce nothing visible: the failure
// line disappeared while the replay ran, so the only way to learn whether the tap
// had registered was to wait and see whether the failures came back. This reducer
// is the missing half — the banner states that a retry started, and reports how
// the batch ended.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { nextRetryFeedback } from "../../../src/pages/capture/retry-feedback.js";
import type { RetryFeedback, RetryFeedbackEvent } from "../../../src/pages/capture/retry-feedback.js";

const idle: RetryFeedback = { phase: "idle" };
// Fold a sequence of events, showing the phase after each.
const trace = (events: RetryFeedbackEvent[]) => {
  let state: RetryFeedback = idle;
  return events.map((e) => (state = nextRetryFeedback(state, e))).map((s) => s.phase).join(" → ");
};

// ## A retry that works
void test("A retry that works", async (t) => {
  t.check(
    trace([
      { type: "retry-tapped", count: 3 },
      { type: "settled", failed: 0 },
      { type: "expire" },
    ]),
    "retrying → recovered → idle",
  );
});

// ## A retry that doesn't
//
// The link is still down; the banner has to say the transfers failed *again*,
// which is the difference between "you did nothing" and "it didn't work":
void test("The link is still down; the banner has to say the transfers failed again, whi...", async (t) => {
  t.check(
    trace([
      { type: "retry-tapped", count: 3 },
      { type: "settled", failed: 2 },
      { type: "retry-tapped", count: 2 },
      { type: "settled", failed: 0 },
    ]),
    "retrying → failed-again → retrying → recovered",
  );
});

// ## What it refuses to claim
//
// A tap with nothing to replay changes nothing — "retrying 0 uploads" is the same
// kind of lie as showing no reaction at all:
void test("A tap with nothing to replay changes nothing — \"retrying 0 uploads\" is the sa...", async (t) => {
  t.check(nextRetryFeedback(idle, { type: "retry-tapped", count: 0 }).phase, "idle");
});

// Transfers settling when no retry is in flight is the ordinary first-attempt
// path, and says nothing about a retry:
void test("Transfers settling when no retry is in flight is the ordinary first-attempt p...", async (t) => {
  t.check(nextRetryFeedback(idle, { type: "settled", failed: 4 }).phase, "idle");
});

// And the recovered notice only expires from `recovered` — a stray timer can't
// wipe an in-flight retry or a live failure off the banner:
void test("And the recovered notice only expires from recovered — a stray timer can't wi...", async (t) => {
  t.check(
    [
      nextRetryFeedback({ phase: "retrying", count: 2 }, { type: "expire" }).phase,
      nextRetryFeedback({ phase: "failed-again", count: 2 }, { type: "expire" }).phase,
    ].join(" / "),
    "retrying / failed-again",
  );
});
