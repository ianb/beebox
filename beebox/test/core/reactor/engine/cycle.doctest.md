# Reactor cycle control flow

`runOneCycle` (`src/core/reactor/engine/cycle.ts`) is one reactor cycle as a pipeline
of named stages — sync → refresh docs → discover → process. These tests
exercise the stage-level contract directly (discovery outcomes, the explicit
processed count) plus the engine-level `maxCycles` cap and stuck-cycle guard
in `runReactor` that consume it.

```ts setup
import { runOneCycle } from "../../../../src/core/reactor/engine/cycle.js";
import { runReactor } from "../../../../src/core/reactor/engine/core.js";
import { finishJob } from "../../../../src/core/finish-job.js";
import { createFakeAgent } from "../../fake-agent.js";
import { makeTmpBox } from "../../../helpers/doctest-helpers.js";
import { createIntakeJobTemplate } from "../../../../src/schemas/intake-job.js";
import { createTodoReviewJobTemplate } from "../../../../src/schemas/todo-review-job.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";

const intakeJob = (description, opts) =>
  createIntakeJobTemplate({ description, items: [], ...(opts ?? {}) });

// Base cycle params: fast fakes for the subprocess/doc stages (same rationale
// as reactor-integration.doctest.md), no filters, sync off.
function cycleParams(boxRoot, agentFactory) {
  return {
    boxRoot,
    dryRun: false,
    sync: false,
    skipLowPriority: false,
    typeFilter: undefined,
    connectorFilter: undefined,
    onLog: undefined,
    agentFactory,
    runSync: async () => true,
    generateDocs: async () => {},
  };
}

const jobsDir = "_bookkeeping/jobs";

/** An `act` that finishes the named job files. */
const finishing = (...names) => async ({ boxRoot }) => {
  for (const name of names) await finishJob({ boxRoot, jobRelPath: `${jobsDir}/${name}` });
  return { success: true };
};

/** An `act` that finishes exactly the jobs its prompt named. */
const finishingPromptedJobs = async ({ boxRoot, prompt }) => {
  for (const file of await fs.readdir(path.join(boxRoot, jobsDir))) {
    if (prompt.includes(file)) await finishJob({ boxRoot, jobRelPath: `${jobsDir}/${file}` });
  }
  return { success: true };
};

/**
 * Build a git box holding `jobs` (file name -> card text under the jobs dir) and run one
 * cycle on it with `act` as the agent (default: do nothing). Returns the cycle result plus
 * `invoked` (agent factory calls in the first run) and `prompts`. `after(box, run)` may inspect the box or
 * run another cycle (`run()`) before the box is removed; its return value is `after`.
 */
async function cycleOn(jobs, { act, skipLowPriority, after }) {
  const box = await makeTmpBox({ git: true });
  try {
    for (const [name, card] of Object.entries(jobs)) await box.write(`${jobsDir}/${name}`, card);
    box.commitAll("add jobs");
    let invoked = 0;
    const prompts = [];
    const factory = (opts) => {
      invoked += 1;
      return createFakeAgent({
        name: opts.name,
        act: async (ctx) => {
          prompts.push(ctx.prompt);
          return act ? act(ctx) : { success: true };
        },
      });
    };
    const run = () => runOneCycle({ ...cycleParams(box.root, factory), skipLowPriority });
    const result = await run();
    const invokedByFirstRun = invoked;
    const afterResult = after ? await after(box, run) : undefined;
    return { ...result, invoked: invokedByFirstRun, prompts, after: afterResult };
  } finally {
    await box.cleanup();
  }
}

/** The cycle result and agent invocation count, without prompts. */
const summary = ({ prompts, after, ...rest }) => rest;

/** Seven low-priority jobs dated 2020-01-01 .. 2020-01-07. */
const overdueBacklog = () =>
  Object.fromEntries(
    Array.from({ length: 7 }, (_, i) => [
      `2020-01-0${i + 1}T00-00-00-b.intake.job.card`,
      intakeJob(`Overdue ${i + 1}`, { priority: "low" }),
    ]),
  );

const engineOverrides = {
  runSync: async () => true,
  runFinalize: async () => true,
  generateDocs: async () => {},
};
```

## Discovery: no jobs → clean no-op cycle

```ts
summary(await cycleOn({}, { skipLowPriority: false }))
=> { success: true, jobsProcessed: 0, jobsRemaining: 0, invoked: 0 }
```

An empty queue never reaches the agent factory.

## Discovery: only low-priority jobs under `skipLowPriority` → skipped, kept pending

The cycle reports them as remaining without invoking any agent.

```ts
summary(await cycleOn({ "later.intake.job.card": intakeJob("Low prio", { priority: "low" }) }, { skipLowPriority: true }))
=> { success: true, jobsProcessed: 0, jobsRemaining: 1, invoked: 0 }
```

## …but only until the wait deadline: an overdue low-priority job runs on its own

`skipLowPriority` buys "an idle box doesn't spend an agent turn every tick on
optional filler". It used to buy "or never" as well — a box whose `_bookkeeping/jobs`
held nothing but low-priority cards skipped every cycle forever, and a
`contains-backfill` card in that state suppressed its own successor too
(observed on a production box at 85, 52 and 40 days). Low priority now means
*may wait*, not *may wait forever*: past 24h pending, the job earns a cycle.

Age comes from the filename's timestamp prefix, which every job-card writer
stamps — no card mutation, and nothing to keep in sync. The block above uses
an unstamped filename, whose age falls back to the mtime and so reads as
young; this one is dated 2020.

```ts
const name = "2020-01-01T00-00-00-stale.intake.job.card";
summary(await cycleOn({ [name]: intakeJob("Long overdue", { priority: "low" }) }, { skipLowPriority: true, act: finishing(name) }))
=> { success: true, jobsProcessed: 1, jobsRemaining: 0, invoked: 1 }
```

## A deadline-triggered cycle takes a bounded batch, oldest first

A box coming out of a long wedge can hold months of deferred work, and every
pending job goes into one agent prompt. Dumping the whole backlog into a
single turn is its own incident, so a cycle that runs *because* of the
deadline admits at most the five oldest overdue jobs; the rest are still
overdue on the next wakeup, so the queue drains at a pace rather than in one
gulp.

Oldest first, so the tail of a backlog can't be starved by newer arrivals —
days 01–05 went, 06 and 07 wait. The next cycle finds them overdue and takes
them.

```ts
const listJobs = async (box) =>
  (await fs.readdir(path.join(box.root, jobsDir))).filter((f) => f !== ".gitkeep").toSorted();
const { after, ...first } = await cycleOn(overdueBacklog(), {
  skipLowPriority: true,
  act: finishingPromptedJobs,
  after: async (box, run) => ({ left: await listJobs(box), second: await run() }),
});
({ first: summary(first), ...after })
=> {
  first: { success: true, jobsProcessed: 5, jobsRemaining: 2, invoked: 1 },
  left: ["2020-01-06T00-00-00-b.intake.job.card", "2020-01-07T00-00-00-b.intake.job.card"],
  second: { success: true, jobsProcessed: 2, jobsRemaining: 0 }
}
```

## Normal work is never delayed by a low-priority backlog

The cap applies only to the deadline path. As soon as any normal-priority job
is pending the cycle runs on everything, as it always did — a pile of overdue
low-priority cards must not push the normal job to a later wakeup. All eight
are offered, and the normal job is listed first.

```ts
const normal = "2026-06-01T00-00-00-now.intake.job.card";
const { prompts, ...mixed } = await cycleOn(
  { ...overdueBacklog(), [normal]: intakeJob("Real work") },
  { skipLowPriority: true },
);
({
  ...summary(mixed),
  hasNormal: prompts[0].includes(normal),
  normalListedFirst: prompts[0].indexOf("2026-06-01T00-00-00-now") < prompts[0].indexOf("2020-01-01T00-00-00-b"),
})
=> { success: true, jobsProcessed: 0, jobsRemaining: 8, invoked: 1, hasNormal: true, normalListedFirst: true }
```

## A `todo-review-job` alone is processed under `skipLowPriority`, not stuck forever

The wakeup `todo-review` sweep (`docs/implemented-plans/todo-annotation.md` Track 5b) is
meant to be a "deterministic hook, not a hope" — but `bbx wakeup` always runs
the reactor with `skipLowPriority: true`, and the discover stage above skips
a cycle entirely when every pending job is low-priority. A `todo-review-job`
that shipped as `priority: low` would then never get processed on an
otherwise-idle box (no other jobs pending), and — being left pending —
would suppress the next sweep's job too. `createTodoReviewJobTemplate`
creates it `priority: normal` for exactly this reason: it must eventually
reach an agent even when it's the only job around.

```ts
const review = "review.todo-review.job.card";
const card = createTodoReviewJobTemplate({
  escalated: [],
  stirring: [{ locator: "a.memo.card:1", text: "Stirring item", detail: "started 2026-07-28" }],
  stale: [],
});
summary(await cycleOn({ [review]: card }, { skipLowPriority: true, act: finishing(review) }))
=> { success: true, jobsProcessed: 1, jobsRemaining: 0, invoked: 1 }
```

## The processed count survives concurrent job additions

The processed count is a set difference against the jobs the cycle set out to
run — not `before - after`. An agent that consumes both originals while a new
job lands concurrently still credits 2 processed (the old subtraction would
have reported 1) and reports the newcomer as remaining.

```ts
const consumeBoth = async ({ boxRoot }) => {
  await finishing("a.intake.job.card", "b.intake.job.card")({ boxRoot });
  // A connector delivers a new job mid-cycle.
  await fs.writeFile(path.join(boxRoot, jobsDir, "new.intake.job.card"), intakeJob("Newcomer"));
  return { success: true };
};
summary(await cycleOn(
  { "a.intake.job.card": intakeJob("Job A"), "b.intake.job.card": intakeJob("Job B") },
  { skipLowPriority: false, act: consumeBoth },
))
=> { success: true, jobsProcessed: 2, jobsRemaining: 1, invoked: 1 }
```

## Engine: `maxCycles` caps the loop even with jobs remaining

Five jobs, one finished per cycle, capped at 2 cycles: the reactor stops at
the cap with the backlog intact.

```ts
const box3 = await makeTmpBox({ git: true });
for (const n of ["j1", "j2", "j3", "j4", "j5"]) {
  await box3.write(`${jobsDir}/${n}.intake.job.card`, intakeJob(`Job ${n}`));
}
box3.commitAll("add jobs");

let cycles = 0;
const onePerCycle = (opts) => {
  const n = ++cycles;
  return createFakeAgent({ name: opts.name, act: finishing(`j${n}.intake.job.card`) });
};

const capped = await runReactor({ boxRoot: box3.root, ...engineOverrides, createAgent: onePerCycle, maxCycles: 2 });
({ processed: capped.jobsProcessed, remaining: capped.jobsRemaining, cycles })
=> { processed: 2, remaining: 3, cycles: 2 }
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
({ processed: stuck.jobsProcessed, remaining: stuck.jobsRemaining, cycles })
=> { processed: 0, remaining: 3, cycles: 1 }
```

```ts cleanup
await box3.cleanup();
```
