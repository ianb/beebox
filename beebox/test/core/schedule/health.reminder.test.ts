// # Health for a `notify:` reminder
//
// A reminder runs no agent, so an engine quota episode does not explain its
// state: health judges it on its own runs. A failed one-shot reminder past its
// 24-hour retry window says the window ended, and when.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import type { ParsedScheduledScript } from "../../../src/schemas/scheduled-script/schema.js";
import { evaluateTaskHealth } from "../../../src/core/schedule/health.js";
import { normalizeScriptState } from "../../../src/core/schedule/state.js";
import { formatRetryAt } from "../../../src/core/agent/engine-unavailability.js";

const AT = "2026-02-21T09:00:00Z";
const HOUR = 60 * 60 * 1000;

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
const failing = normalizeScriptState({
  lastRun: "2026-02-21T09:00:00Z",
  lastResult: "failure",
  consecutiveFailures: 1,
  lastError: "Not delivered: push failed",
});

function health(parsed: ParsedScheduledScript, options: { now: Date; engineWaitReason?: string }) {
  const task = evaluateTaskHealth({
    name: "remind-vet", parsed, state: failing, now: options.now,
    cardMtime: new Date(AT), missingConnectors: [], engineWaitReason: options.engineWaitReason,
  });
  return { status: task.status, reason: task.reason };
}

void test("during a quota episode a failed reminder shows failing; a command shows waiting", async (t) => {
  const now = new Date("2026-02-21T09:05:00Z");
  const engineWaitReason = "waiting on claude quota until Feb 21, 3:00 PM";
  t.check(
    [health(reminder, { now, engineWaitReason }), health(command, { now, engineWaitReason })],
    [{ status: "failing", reason: undefined }, { status: "waiting", reason: engineWaitReason }],
  );
});

void test("after the retry window a failed reminder says the window ended", async (t) => {
  const endedAt = new Date(new Date(AT).getTime() + 24 * HOUR);
  t.check(health(reminder, { now: new Date(endedAt.getTime() + HOUR) }), {
    status: "failing",
    reason: `retry window ended ${formatRetryAt(endedAt.toISOString())}`,
  });
  // Inside the window there is no such reason; a `runs:` card never has one:
  t.check(
    [
      health(reminder, { now: new Date(endedAt.getTime() - HOUR) }),
      health(command, { now: new Date(endedAt.getTime() + HOUR) }),
    ],
    [{ status: "failing", reason: undefined }, { status: "failing", reason: undefined }],
  );
});
