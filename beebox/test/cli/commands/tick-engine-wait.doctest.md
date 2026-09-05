# Tick and engine unavailability — skip, defer, freeze

When the box's engine is out of quota (deferred-recoverable), the scheduler
must not burn attempts: due scripts skip with a visible reason until the
reset, and a run that failed *because* of the episode records a `deferred`
outcome that freezes — neither increments nor resets — `consecutiveFailures`.

```ts setup
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { evaluateSkip } from "../../../src/cli/commands/tick-helpers.js";
import { classifyScheduleFailure } from "../../../src/core/schedule/engine-wait.js";
import { recordEngineUnavailability } from "../../../src/core/agent/engine-availability-store.js";
import { recordOutcome, normalizeScriptState } from "../../../src/core/schedule/state.js";

function makeScript(overrides = {}) {
  return {
    cron: undefined, at: undefined, rrule: undefined, until: undefined,
    notBefore: undefined, onWakeup: true, once: false, enabled: true,
    runs: "echo test", description: undefined, source: undefined,
    createAfterSuccess: [], budget: undefined, lockGroup: undefined,
    timeoutMs: undefined, requires: undefined,
    ...overrides,
  };
}

// The store's liveness check runs against the real clock (getBoxTime), so
// the episode times here are relative to it — not a frozen fake date.
const NOW = new Date();

function makeCtx(overrides = {}) {
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
```

## A live episode skips due scripts — visibly, and `--force` overrides

```ts
const dir = await fs.mkdtemp(path.join(os.tmpdir(), "tick-engine-wait-"));
t.teardown(async () => {
  delete process.env.BBX_ENGINE_AVAILABILITY_FILE;
  await fs.rm(dir, { recursive: true, force: true });
});
process.env.BBX_ENGINE_AVAILABILITY_FILE = path.join(dir, "engine-availability.json");

const reset = new Date(NOW.getTime() + 6 * 60 * 60 * 1000);
await recordEngineUnavailability(claudeQuota({ detectedAt: NOW, retryAt: reset }));

const skip = await evaluateSkip(makeCtx());
skip !== null && skip.includes("waiting on claude quota until")
=> true

await evaluateSkip(makeCtx({ options: { force: true } }))
=> null
```

`lastRun` was untouched by the skip, so the script stays due and runs on the
first tick after the episode expires:

```ts continue
process.env.BBX_ENGINE_AVAILABILITY_FILE = path.join(dir, "empty.json");
await evaluateSkip(makeCtx())
=> null
```

## Only a record from this run's own span defers the failure

The freshness requirement stops the store from laundering unrelated
failures: a script that dies of its own bug during someone else's episode
fails normally.

```ts continue
process.env.BBX_ENGINE_AVAILABILITY_FILE = path.join(dir, "engine-availability.json");
const fresh = await classifyScheduleFailure({
  boxRoot: "/nonexistent",
  runStartedAt: new Date(NOW.getTime() - 60_000),
  error: new Error("Command failed with exit code 1"),
});
fresh.result
=> deferred

fresh.error.startsWith("Claude is out of usage quota until ")
=> true

const stale = await classifyScheduleFailure({
  boxRoot: "/nonexistent",
  runStartedAt: new Date(NOW.getTime() + 60_000),
  error: new Error("Command failed with exit code 1"),
});
stale.result
=> failure

stale.error
=> Command failed with exit code 1
```

## A deferred outcome freezes the failure counter

Not incremented (the engine was unavailable, not the task broken) and not
reset (a genuinely broken task doesn't get its counter laundered by a quota
episode):

```ts
const state = normalizeScriptState({ lastResult: "failure", consecutiveFailures: 4 });
recordOutcome(state, {
  result: "deferred",
  error: "Claude is out of usage quota until Jun 9, 6:00 PM",
  durationMs: 1200,
  sleepAffected: false,
  windowMs: 24 * 60 * 60 * 1000,
  now: new Date("2026-06-09T12:00:00Z"),
});
print(`${state.lastResult}, failures: ${state.consecutiveFailures}`);
=> deferred, failures: 4

state.lastError
=> Claude is out of usage quota until Jun 9, 6:00 PM
```
