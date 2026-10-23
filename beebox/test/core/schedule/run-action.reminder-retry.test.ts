// # A reminder retries a send a channel tried, not one no channel could try
//
// When a channel tried the send and it failed, a later try can get through, so
// the reminder stays due on its backoff. When every channel skipped (no
// device, no subscription), no later try can reach anyone: the failure is
// final and the reminder is not due again.

import { test, type Test } from "tap";
import "@ianbicking/tap-check/tap";
import type { ParsedScheduledScript } from "../../../src/schemas/scheduled-script/schema.js";
import type { Delivery } from "../../../src/core/notification/intent.js";
import type { NotifyResult } from "../../../src/core/notify-boxholder.js";
import * as notify from "../../../src/core/notify-boxholder.js";
import type * as RunAction from "../../../src/core/schedule/run-action.js";
import { isDue } from "../../../src/schemas/scheduled-script/due.js";
import { loadScriptState } from "../../../src/core/schedule/state.js";
import { makeTmpBox } from "../../helpers/test-helpers.js";

const AT = "2026-10-21T20:00:00Z";
const MINUTE = 60_000;

const reminder: ParsedScheduledScript = {
  cron: undefined, at: AT, rrule: undefined, until: undefined,
  notBefore: undefined, onWakeup: false, once: true, enabled: true,
  action: { kind: "notify", notify: { title: "Call back" } }, requestedBy: "boxholder",
  description: undefined, reason: undefined, createAfterSuccess: [], budget: undefined,
  lockGroup: undefined, timeoutMs: undefined, requires: undefined,
};

/** Send the reminder once with `notifyBoxholder` returning `deliveries`; then whether it is due 1, 2 and 4 minutes later. */
async function sendThenDue(t: Test, deliveries: Delivery[]) {
  const box = await makeTmpBox({ git: true });
  t.teardown(() => box.cleanup());
  const sent: NotifyResult = { id: "n1", deliveries, shown: false };
  const { runAndRecord } = await t.mockImport<typeof RunAction>(
    "../../../src/core/schedule/run-action.ts",
    { "../../../src/core/notify-boxholder.ts": { ...notify, notifyBoxholder: async () => sent } },
  );
  const now = new Date(AT);
  const state = await loadScriptState(box.root, "remind-call");
  const run = await runAndRecord({
    boxRoot: box.root, parsed: reminder, scriptName: "remind-call", triggeredBy: "schedule",
    stdio: "ignore", state, now, runStartedAt: now,
  });
  const saved = await loadScriptState(box.root, "remind-call");
  const ctx = {
    lastRun: saved.lastRun, lastResult: saved.lastResult, consecutiveFailures: saved.consecutiveFailures,
    lastFailureFinal: saved.lastFailureFinal === true,
  };
  return {
    result: run.result,
    final: saved.lastFailureFinal ?? false,
    dueAfter: [1, 2, 4].map((m) => isDue(reminder, { ...ctx, now: new Date(now.getTime() + m * MINUTE) })),
  };
}

void test("a send a channel tried and failed is retried on the backoff", async (t) => {
  const outcome = await sendThenDue(t, [
    { channel: "apns", status: "skipped", detail: "no-audience" },
    { channel: "web-push", status: "failed", detail: "no device received the push (sent 0, pruned 0, failed 1)" },
  ]);
  // One failure waits one minute, so the reminder is due again from then on:
  t.check(outcome, { result: "failure", final: false, dueAfter: [true, true, true] });
});

void test("a send no channel could try is final and not retried", async (t) => {
  const outcome = await sendThenDue(t, [
    { channel: "apns", status: "skipped", detail: "no-audience" },
    { channel: "web-push", status: "skipped", detail: "no-audience" },
  ]);
  t.check(outcome, { result: "failure", final: true, dueAfter: [false, false, false] });
});
