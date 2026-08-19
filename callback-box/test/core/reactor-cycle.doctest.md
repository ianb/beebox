# Reactor cycle control flow

`runOneCycle` (`src/core/reactor/cycle.ts`) is one reactor cycle as a pipeline
of named stages — sync → refresh docs → discover → process. These tests
exercise the stage-level contract directly (discovery outcomes, the explicit
processed count) plus the engine-level `maxCycles` cap and stuck-cycle guard
in `runReactor` that consume it.

```ts setup
import { runOneCycle } from "../../src/core/reactor/cycle.js";
import { runReactor } from "../../src/core/reactor/index.js";
import { finishJob } from "../../src/core/finish-job.js";
import { createFakeAgent } from "../helpers/fake-agent.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
import { createIntakeJobTemplate } from "../../src/schemas/index.js";
import { createTodoReviewJobTemplate } from "../../src/schemas/todo-review-job.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";

const intakeJob = (description, opts) =>
  createIntakeJobTemplate({ source: "test", description, items: [], ...(opts ?? {}) });

// Base cycle params: fast fakes for the subprocess/doc stages (same rationale
// as reactor-integration.doctest.md), no filters, sync off.
function cycleParams(boxRoot, agentFactory) {
  return {
    boxRoot,
    dryRun: false,
    sync: false,
    skipLowPriority: false,
    typeFilter: undefined,
    sourceFilter: undefined,
    onLog: undefined,
    agentFactory,
    runSync: async () => true,
    generateDocs: async () => {},
  };
}

const engineOverrides = {
  runSync: async () => true,
  runFinalize: async () => true,
  generateDocs: async () => {},
};
```

## Discovery: no jobs → clean no-op cycle

```ts
const box = await makeTmpBox({ git: true });
const agentFactory = (opts) => createFakeAgent({ name: opts.name, act: async () => ({ success: true }) });
const result = await runOneCycle(cycleParams(box.root, agentFactory));
JSON.stringify(result)
=> {"success":true,"jobsProcessed":0,"jobsRemaining":0}
```

## Discovery: only low-priority jobs under `skipLowPriority` → skipped, kept pending

The cycle reports them as remaining without invoking any agent.

```ts continue
await box.write("box/jobs/later.intake.job.card", intakeJob("Low prio", { priority: "low" }));
box.commitAll("add low-prio job");

let invoked = 0;
const countingFactory = (opts) => {
  invoked += 1;
  return createFakeAgent({ name: opts.name, act: async () => ({ success: true }) });
};
const skipped = await runOneCycle({ ...cycleParams(box.root, countingFactory), skipLowPriority: true });
JSON.stringify({ ...skipped, invoked })
=> {"success":true,"jobsProcessed":0,"jobsRemaining":1,"invoked":0}
```

```ts cleanup
await box.cleanup();
```

## …but only until the wait deadline: an overdue low-priority job runs on its own

`skipLowPriority` buys "an idle box doesn't spend an agent turn every tick on
optional filler". It used to buy "or never" as well — a box whose `box/jobs`
held nothing but low-priority cards skipped every cycle forever, and a
`contains-backfill` card in that state suppressed its own successor too
(observed on a production box at 85, 52 and 40 days). Low priority now means
*may wait*, not *may wait forever*: past 24h pending, the job earns a cycle.

Age comes from the filename's timestamp prefix, which every job-card writer
stamps — no card mutation, and nothing to keep in sync. The block above uses
an unstamped filename, whose age falls back to the mtime and so reads as
young; this one is dated 2020.

```ts
const boxOld = await makeTmpBox({ git: true });
await boxOld.write("box/jobs/2020-01-01T00-00-00-stale.intake.job.card", intakeJob("Long overdue", { priority: "low" }));
boxOld.commitAll("add an overdue low-prio job");

let oldInvoked = 0;
const oldFactory = (opts) => {
  oldInvoked += 1;
  return createFakeAgent({ name: opts.name, act: async ({ boxRoot }) => {
    await finishJob({ boxRoot, jobRelPath: "box/jobs/2020-01-01T00-00-00-stale.intake.job.card" });
    return { success: true };
  } });
};
const drained = await runOneCycle({ ...cycleParams(boxOld.root, oldFactory), skipLowPriority: true });
JSON.stringify({ ...drained, invoked: oldInvoked })
=> {"success":true,"jobsProcessed":1,"jobsRemaining":0,"invoked":1}
```

```ts cleanup
await boxOld.cleanup();
```

## A deadline-triggered cycle takes a bounded batch, oldest first

A box coming out of a long wedge can hold months of deferred work, and every
pending job goes into one agent prompt. Dumping the whole backlog into a
single turn is its own incident, so a cycle that runs *because* of the
deadline admits at most the five oldest overdue jobs; the rest are still
overdue on the next wakeup, so the queue drains at a pace rather than in one
gulp.

```ts
const boxMany = await makeTmpBox({ git: true });
for (let i = 1; i <= 7; i++) {
  const day = String(i).padStart(2, "0");
  await boxMany.write(`box/jobs/2020-01-${day}T00-00-00-b.intake.job.card`, intakeJob(`Overdue ${String(i)}`, { priority: "low" }));
}
boxMany.commitAll("add seven overdue low-prio jobs");

// The agent finishes exactly the jobs its prompt named.
const manyFactory = (opts) => createFakeAgent({ name: opts.name, act: async ({ boxRoot, prompt }) => {
  for (const file of await fs.readdir(path.join(boxRoot, "box/jobs"))) {
    if (prompt.includes(file)) await finishJob({ boxRoot, jobRelPath: `box/jobs/${file}` });
  }
  return { success: true };
} });
const capped = await runOneCycle({ ...cycleParams(boxMany.root, manyFactory), skipLowPriority: true });
JSON.stringify(capped)
=> {"success":true,"jobsProcessed":5,"jobsRemaining":2}
```

Oldest first, so the tail of a backlog can't be starved by newer arrivals —
days 01–05 went, 06 and 07 wait.

```ts continue
JSON.stringify((await fs.readdir(path.join(boxMany.root, "box/jobs"))).toSorted())
=> ["2020-01-06T00-00-00-b.intake.job.card","2020-01-07T00-00-00-b.intake.job.card"]
```

The next cycle finds them overdue and takes them.

```ts continue
const second = await runOneCycle({ ...cycleParams(boxMany.root, manyFactory), skipLowPriority: true });
JSON.stringify(second)
=> {"success":true,"jobsProcessed":2,"jobsRemaining":0}
```

```ts cleanup
await boxMany.cleanup();
```

## Normal work is never delayed by a low-priority backlog

The cap applies only to the deadline path. As soon as any normal-priority job
is pending the cycle runs on everything, as it always did — a pile of overdue
low-priority cards must not push the normal job to a later wakeup.

```ts
const boxMixed = await makeTmpBox({ git: true });
for (let i = 1; i <= 7; i++) {
  const day = String(i).padStart(2, "0");
  await boxMixed.write(`box/jobs/2020-01-${day}T00-00-00-b.intake.job.card`, intakeJob(`Overdue ${String(i)}`, { priority: "low" }));
}
await boxMixed.write("box/jobs/2026-06-01T00-00-00-now.intake.job.card", intakeJob("Real work"));
boxMixed.commitAll("add a normal job among the backlog");

let mixedPrompt = "";
const mixedFactory = (opts) => createFakeAgent({ name: opts.name, act: async ({ prompt }) => {
  mixedPrompt = prompt;
  return { success: true };
} });
const mixed = await runOneCycle({ ...cycleParams(boxMixed.root, mixedFactory), skipLowPriority: true });
JSON.stringify({ ...mixed, hasNormal: mixedPrompt.includes("2026-06-01T00-00-00-now.intake.job.card") })
=> {"success":true,"jobsProcessed":0,"jobsRemaining":8,"hasNormal":true}
```

All eight are offered, and the normal job is listed first.

```ts continue
mixedPrompt.indexOf("2026-06-01T00-00-00-now") < mixedPrompt.indexOf("2020-01-01T00-00-00-b")
=> true
```

```ts cleanup
await boxMixed.cleanup();
```

## A `todo-review-job` alone is processed under `skipLowPriority`, not stuck forever

The wakeup `todo-review` sweep (`docs/implemented-plans/todo-annotation.md` Track 5b) is
meant to be a "deterministic hook, not a hope" — but `cb wakeup` always runs
the reactor with `skipLowPriority: true`, and the discover stage above skips
a cycle entirely when every pending job is low-priority. A `todo-review-job`
that shipped as `priority: low` would then never get processed on an
otherwise-idle box (no other jobs pending), and — being left pending —
would suppress the next sweep's job too. `createTodoReviewJobTemplate`
creates it `priority: normal` for exactly this reason: it must eventually
reach an agent even when it's the only job around.

```ts
const boxTodo = await makeTmpBox({ git: true });
await boxTodo.write(
  "box/jobs/review.todo-review.job.card",
  createTodoReviewJobTemplate({ escalated: [], stirring: [{ locator: "a.memo.card:1", text: "Stirring item", detail: "started 2026-07-28" }], stale: [] }),
);
boxTodo.commitAll("queue todo-review job");

let todoInvoked = 0;
const todoFactory = (opts) => {
  todoInvoked += 1;
  return createFakeAgent({ name: opts.name, act: async ({ boxRoot }) => {
    await finishJob({ boxRoot, jobRelPath: "box/jobs/review.todo-review.job.card" });
    return { success: true };
  } });
};
const todoResult = await runOneCycle({ ...cycleParams(boxTodo.root, todoFactory), skipLowPriority: true });
JSON.stringify({ ...todoResult, invoked: todoInvoked })
=> {"success":true,"jobsProcessed":1,"jobsRemaining":0,"invoked":1}
```

```ts cleanup
await boxTodo.cleanup();
```

## The processed count survives concurrent job additions

The processed count is a set difference against the jobs the cycle set out to
run — not `before - after`. An agent that consumes both originals while a new
job lands concurrently still credits 2 processed (the old subtraction would
have reported 1) and reports the newcomer as remaining.

```ts
const box2 = await makeTmpBox({ git: true });
await box2.write("box/jobs/a.intake.job.card", intakeJob("Job A"));
await box2.write("box/jobs/b.intake.job.card", intakeJob("Job B"));
box2.commitAll("add jobs");

const agentFactory2 = (opts) =>
  createFakeAgent({
    name: opts.name,
    act: async ({ boxRoot }) => {
      await finishJob({ boxRoot, jobRelPath: "box/jobs/a.intake.job.card" });
      await finishJob({ boxRoot, jobRelPath: "box/jobs/b.intake.job.card" });
      // A connector delivers a new job mid-cycle.
      await fs.writeFile(path.join(boxRoot, "box/jobs/new.intake.job.card"), intakeJob("Newcomer"));
      return { success: true };
    },
  });

const counted = await runOneCycle(cycleParams(box2.root, agentFactory2));
JSON.stringify(counted)
=> {"success":true,"jobsProcessed":2,"jobsRemaining":1}
```

```ts cleanup
await box2.cleanup();
```

## Engine: `maxCycles` caps the loop even with jobs remaining

Five jobs, one finished per cycle, capped at 2 cycles: the reactor stops at
the cap with the backlog intact.

```ts
const box3 = await makeTmpBox({ git: true });
for (const n of ["j1", "j2", "j3", "j4", "j5"]) {
  await box3.write(`box/jobs/${n}.intake.job.card`, intakeJob(`Job ${n}`));
}
box3.commitAll("add jobs");

let cycles = 0;
const onePerCycle = (opts) => {
  const n = ++cycles;
  return createFakeAgent({
    name: opts.name,
    act: async ({ boxRoot }) => {
      await finishJob({ boxRoot, jobRelPath: `box/jobs/j${n}.intake.job.card` });
      return { success: true };
    },
  });
};

const capped = await runReactor({ boxRoot: box3.root, ...engineOverrides, createAgent: onePerCycle, maxCycles: 2 });
JSON.stringify({ processed: capped.jobsProcessed, remaining: capped.jobsRemaining, cycles })
=> {"processed":2,"remaining":3,"cycles":2}
```

## Engine: a stuck cycle stops the loop early

An agent that consumes nothing would loop forever; the engine breaks after one
zero-progress cycle instead of burning through `maxCycles`.

```ts continue
cycles = 0;
const stuckFactory = (opts) => {
  cycles += 1;
  return createFakeAgent({ name: opts.name, act: async () => ({ success: true }) });
};
const stuck = await runReactor({ boxRoot: box3.root, ...engineOverrides, createAgent: stuckFactory, maxCycles: 3 });
JSON.stringify({ processed: stuck.jobsProcessed, remaining: stuck.jobsRemaining, cycles })
=> {"processed":0,"remaining":3,"cycles":1}
```

```ts cleanup
await box3.cleanup();
```
