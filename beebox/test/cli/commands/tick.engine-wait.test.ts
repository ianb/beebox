// # Tick and engine unavailability — skip, defer, freeze
//
// When the box's engine is out of quota (deferred-recoverable), the scheduler
// must not burn attempts: due scripts skip with a visible reason until the
// reset, and a run that failed *because* of the episode records a `deferred`
// outcome that freezes — neither increments nor resets — `consecutiveFailures`.

import { test } from "tap";
import "agent-doctest/tap";
import { printed } from "agent-doctest/check";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { ParsedScheduledScript } from "../../../src/schemas/scheduled-script/schema.js";
import { evaluateSkip } from "../../../src/cli/tick-helpers.js";
import { classifyScheduleFailure } from "../../../src/core/schedule/engine-wait.js";
import { recordEngineUnavailability } from "../../../src/core/agent/engine-availability-store.js";
import { recordOutcome, normalizeScriptState } from "../../../src/core/schedule/state.js";

function makeScript(overrides?: Partial<ParsedScheduledScript>): ParsedScheduledScript {
  return {
    cron: undefined, at: undefined, rrule: undefined, until: undefined,
    notBefore: undefined, onWakeup: true, once: false, enabled: true,
    action: { kind: "runs", command: "echo test" }, requestedBy: undefined,
    description: undefined, reason: undefined,
    createAfterSuccess: [], budget: undefined, lockGroup: undefined,
    timeoutMs: undefined, requires: undefined,
    ...overrides,
  };
}

// The store's liveness check runs against the real clock (getBoxTime), so
// the episode times here are relative to it — not a frozen fake date.
const NOW = new Date();

function makeCtx(overrides?: Record<string, unknown>) {
  return {
    boxRoot: "/nonexistent",
    scriptName: "test-script",
    parsed: makeScript(),
    state: normalizeScriptState({ lastRun: null }),
    now: NOW,
    running: new Map(),
    options: {},
    ...overrides,
  };
}

// A box with no config defaults to the claude engine.
function claudeQuota(options: { detectedAt: Date; retryAt: Date }) {
  return {
    provider: "claude" as const,
    reason: "quota-exhausted" as const,
    retryAt: options.retryAt.toISOString(),
    retryAtSource: "parsed" as const,
    detectedAt: options.detectedAt.toISOString(),
    message: "Claude AI usage limit reached|1780000000",
  };
}

// ## A live episode skips due scripts — visibly, and `--force` overrides
void test("A live episode skips due scripts — visibly, and `--force` overrides", async (t) => {
  // doctest:L63
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "tick-engine-wait-"));
  t.teardown(async () => {
    delete process.env.BBX_ENGINE_AVAILABILITY_FILE;
    await fs.rm(dir, { recursive: true, force: true });
  });
  process.env.BBX_ENGINE_AVAILABILITY_FILE = path.join(dir, "engine-availability.json");

  // doctest:L70
  const reset = new Date(NOW.getTime() + 6 * 60 * 60 * 1000);
  await recordEngineUnavailability(claudeQuota({ detectedAt: NOW, retryAt: reset }));

  // doctest:L73
  const skip = await evaluateSkip(makeCtx());
  t.check(`${skip?.cause?.reason} | ${skip?.line.includes("waiting on claude quota until")}`, "engine-quota | true");

  // doctest:L77
  t.check(await evaluateSkip(makeCtx({ options: { force: true } })), null);

  // `lastRun` was untouched by the skip, so the script stays due and runs on the
  // first tick after the episode expires:

  // doctest:L85
  process.env.BBX_ENGINE_AVAILABILITY_FILE = path.join(dir, "empty.json");
  t.check(await evaluateSkip(makeCtx()), null);

  // ## Only a record from this run's own span defers the failure
  //
  // The freshness requirement stops the store from laundering unrelated
  // failures: a script that dies of its own bug during someone else's episode
  // fails normally.

  // doctest:L97
  process.env.BBX_ENGINE_AVAILABILITY_FILE = path.join(dir, "engine-availability.json");
  const fresh = await classifyScheduleFailure({
    boxRoot: "/nonexistent",
    runStartedAt: new Date(NOW.getTime() - 60_000),
    error: new Error("Command failed with exit code 1"),
  });
  t.check(fresh.result, "deferred");

  // doctest:L106
  await t.checkText(fresh.error.startsWith("Claude is out of usage quota until "), "true");

  // doctest:L109
  const stale = await classifyScheduleFailure({
    boxRoot: "/nonexistent",
    runStartedAt: new Date(NOW.getTime() + 60_000),
    error: new Error("Command failed with exit code 1"),
  });
  t.check(stale.result, "failure");

  // doctest:L117
  t.check(stale.error, "Command failed with exit code 1");
});

// ## A deferred outcome freezes the failure counter
//
// Not incremented (the engine was unavailable, not the task broken) and not
// reset (a genuinely broken task doesn't get its counter laundered by a quota
// episode):
void test("Not incremented (the engine was unavailable, not the task broken) and not res...", async (t) => {
  const out2 = printed();
  const print = out2.print;
  // doctest:L128
  const state = normalizeScriptState({ lastResult: "failure", consecutiveFailures: 4 });
  recordOutcome(state, {
    result: "deferred",
    error: "Claude is out of usage quota until Jun 9, 6:00 PM",
    durationMs: 1200,
    sleepAffected: false,
    windowMs: 24 * 60 * 60 * 1000,
    now: new Date("2026-06-09T12:00:00Z"),
  });
  await t.checkText(out2.with(print(`${state.lastResult}, failures: ${state.consecutiveFailures}`)), "deferred, failures: 4");

  // doctest:L140
  await t.checkText(out2.with(state.lastError), "Claude is out of usage quota until Jun 9, 6:00 PM");
});
