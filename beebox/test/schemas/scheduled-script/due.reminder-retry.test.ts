// # A failed reminder retries for a day
//
// A one-shot `at` card whose action is `notify:` and whose send failed stays
// due, with backoff (1, 2, 4 … minutes, capped at 60), until 24 hours after
// its `at`. A `runs:` one-shot gets one attempt: its command may have side
// effects.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import type { ParsedScheduledScript } from "../../../src/schemas/scheduled-script/schema.js";
import {
  isDue,
  reminderRetryBackoffMs,
  REMINDER_RETRY_WINDOW_MS,
} from "../../../src/schemas/scheduled-script/due.js";

const AT = "2026-02-21T09:00:00Z";
const MINUTE = 60_000;

function makeScript(action: ParsedScheduledScript["action"]): ParsedScheduledScript {
  return {
    cron: undefined, at: AT, rrule: undefined, until: undefined,
    notBefore: undefined, onWakeup: false, once: true, enabled: true,
    action, requestedBy: undefined, description: undefined, reason: undefined,
    createAfterSuccess: [], budget: undefined, lockGroup: undefined,
    timeoutMs: undefined, requires: undefined,
  };
}

const reminder = makeScript({ kind: "notify", notify: { title: "Call the vet" } });
const command = makeScript({ kind: "runs", command: "echo hi" });

/** `at` plus `ms`, as a Date. */
function after(ms: number): Date {
  return new Date(new Date(AT).getTime() + ms);
}

/** The state after `failures` failed sends, the last one at `at + lastRunMs`. */
function failed(failures: number, lastRunMs: number) {
  return { lastRun: after(lastRunMs).toISOString(), lastResult: "failure" as const, consecutiveFailures: failures, lastFailureFinal: false };
}

void test("the first send is due at `at`, not before", async (t) => {
  const fresh = { lastRun: null, lastResult: null, consecutiveFailures: 0, lastFailureFinal: false };
  t.check(
    [isDue(reminder, { ...fresh, now: after(-1) }), isDue(reminder, { ...fresh, now: after(0) })],
    [false, true],
  );
});

void test("after one failure the next try waits one minute", async (t) => {
  t.check(
    [
      isDue(reminder, { ...failed(1, 0), now: after(30_000) }),
      isDue(reminder, { ...failed(1, 0), now: after(MINUTE) }),
    ],
    [false, true],
  );
});

void test("the backoff doubles per failure and caps at 60 minutes", async (t) => {
  t.check(
    [1, 2, 3, 6, 7, 20].map((n) => reminderRetryBackoffMs(n) / MINUTE),
    [1, 2, 4, 32, 60, 60],
  );
  // After 7 failures the wait is 60 minutes:
  t.check(
    [
      isDue(reminder, { ...failed(7, 0), now: after(59 * MINUTE) }),
      isDue(reminder, { ...failed(7, 0), now: after(60 * MINUTE) }),
    ],
    [false, true],
  );
});

void test("retries stop 24 hours after `at`", async (t) => {
  const lastTry = REMINDER_RETRY_WINDOW_MS - 2 * 60 * MINUTE;
  t.check(
    [
      isDue(reminder, { ...failed(30, lastTry), now: after(REMINDER_RETRY_WINDOW_MS - MINUTE) }),
      isDue(reminder, { ...failed(30, lastTry), now: after(REMINDER_RETRY_WINDOW_MS + MINUTE) }),
    ],
    [true, false],
  );
});

void test("a delivered reminder is not due again", async (t) => {
  t.check(
    isDue(reminder, { lastRun: after(0).toISOString(), lastResult: "success", consecutiveFailures: 0, lastFailureFinal: false, now: after(10 * MINUTE) }),
    false,
  );
});

void test("a failed `runs:` one-shot is not due again", async (t) => {
  t.check(isDue(command, { ...failed(1, 0), now: after(10 * MINUTE) }), false);
});

void test("a final failure is not retried, unless the card moves `at` past it", async (t) => {
  // The send at `at` reached no channel (no device, no subscription): final.
  const finalFailure = { ...failed(1, 0), lastFailureFinal: true };
  // The card edited to an hour later (a device may be registered since) is a new attempt:
  const edited = { ...reminder, at: after(60 * MINUTE).toISOString() };
  t.check(
    [
      isDue(reminder, { ...finalFailure, now: after(60 * MINUTE) }),
      isDue(edited, { ...finalFailure, now: after(60 * MINUTE) }),
    ],
    [false, true],
  );
});
