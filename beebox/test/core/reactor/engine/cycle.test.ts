// # Reactor cycle control flow
//
// `runOneCycle` (`src/core/reactor/engine/cycle.ts`) is one reactor cycle as a pipeline
// of named stages — sync → refresh docs → discover → process. These tests
// exercise the stage-level contract directly (discovery outcomes, the explicit
// processed count) plus the engine-level `maxCycles` cap and stuck-cycle guard
// in `runReactor` that consume it.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any, str } from "@ianbicking/tap-check/check";
import { runOneCycle } from "../../../../src/core/reactor/engine/cycle.js";
import type { CycleResult, RunCycleParams } from "../../../../src/core/reactor/engine/cycle.js";
import { runReactor } from "../../../../src/core/reactor/engine/core.js";
import type { createAgent } from "../../../../src/core/agent/invoke/core.js";
import { invariant } from "../../../../src/shared/invariant.js";
import { finishJob } from "../../../../src/core/finish-job.js";
import { createFakeAgent } from "../../fake-agent.js";
import { makeTmpBox } from "../../../helpers/test-helpers.js";
import type { TmpBox } from "../../../helpers/test-helpers.js";
import { createIntakeJobTemplate } from "../../../../src/schemas/intake-job.js";
import { createContainsBackfillJobTemplate } from "../../../../src/schemas/contains-backfill-job.js";
import { createQuestionFollowupJobTemplate } from "../../../../src/schemas/question-followup-job.js";
import { createTodoReviewJobTemplate } from "../../../../src/schemas/todo-review-job.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";

type CreateAgentOptions = Parameters<typeof createAgent>[0];
type FakeAct = Parameters<typeof createFakeAgent>[0]["act"];

const intakeJob = (description: string, opts?: { priority?: "normal" | "low" }) =>
  createIntakeJobTemplate({ description, items: [], ...opts });

// A batch carries at most one intake job, so tests that need several jobs in
// one batch use other job types: a normal-priority question follow-up and a
// low-priority contains-backfill.
const followupJob = (description: string) =>
  createQuestionFollowupJobTemplate({ description, questionRef: "_content/questions/q.question.card", directive: "Act on it", answer: "Yes" });
const backfillJob = () => createContainsBackfillJobTemplate({ items: [], remaining: 0 });

// Base cycle params: fast fakes for the subprocess/doc stages (same rationale
// as test/core/reactor/engine.integration.test.ts), no filters, sync off.
function cycleParams(boxRoot: string, agentFactory: RunCycleParams["agentFactory"]): RunCycleParams {
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
    attempted: new Set<string>(),
  };
}

const jobsDir = "_bookkeeping/jobs";

/** An `act` that finishes the named job files. */
const finishing = (...names: string[]) => async ({ boxRoot }: { boxRoot: string }) => {
  for (const name of names) await finishJob({ boxRoot, jobRelPath: `${jobsDir}/${name}` });
  return { success: true };
};

/** An `act` that finishes exactly the jobs its prompt named. */
const finishingPromptedJobs = async ({ boxRoot, prompt }: { boxRoot: string; prompt: string }) => {
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
async function cycleOn<A = undefined>(
  jobs: Record<string, string>,
  { act, skipLowPriority, after }: {
    act?: FakeAct;
    skipLowPriority: boolean;
    after?: (box: TmpBox, run: () => Promise<CycleResult>) => Promise<A>;
  },
) {
  const box = await makeTmpBox({ git: true });
  try {
    for (const [name, card] of Object.entries(jobs)) await box.write(`${jobsDir}/${name}`, card);
    box.commitAll("add jobs");
    let invoked = 0;
    const prompts: string[] = [];
    const factory = (opts: CreateAgentOptions) => {
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
const summary = ({ prompts: _prompts, after: _after, ...rest }: { prompts?: unknown; after?: unknown; [key: string]: unknown }) => rest;

/** Seven low-priority jobs dated 2020-01-01 .. 2020-01-07. */
const overdueBacklog = () =>
  Object.fromEntries(
    Array.from({ length: 7 }, (_, i) => [
      `2020-01-0${i + 1}T00-00-00-b.contains-backfill.job.card`,
      backfillJob(),
    ]),
  );

const engineOverrides = {
  runSync: async () => true,
  runFinalize: async () => true,
  generateDocs: async () => {},
};

// ## Discovery: no jobs → clean no-op cycle
void test("Discovery: no jobs → clean no-op cycle", async (t) => {
  t.check(summary(await cycleOn({}, { skipLowPriority: false })), {
    success: true,
    jobsProcessed: 0,
    jobsRemaining: 0,
    selected: 0,
    invoked: 0,
  });
});

// An empty queue never reaches the agent factory.
//
// ## Discovery: only low-priority jobs under `skipLowPriority` → skipped, kept pending
//
// The cycle reports them as remaining without invoking any agent.
void test("An empty queue never reaches the agent factory.", async (t) => {
  t.check(summary(await cycleOn({ "later.intake.job.card": intakeJob("Low prio", { priority: "low" }) }, { skipLowPriority: true })), {
    success: true,
    jobsProcessed: 0,
    jobsRemaining: 1,
    selected: 0,
    invoked: 0,
  });
});

// ## …but only until the wait deadline: an overdue low-priority job runs on its own
//
// `skipLowPriority` buys "an idle box doesn't spend an agent turn every tick on
// optional filler". It used to buy "or never" as well — a box whose `_bookkeeping/jobs`
// held nothing but low-priority cards skipped every cycle forever, and a
// `contains-backfill` card in that state suppressed its own successor too
// (observed on a production box at 85, 52 and 40 days). Low priority now means
// *may wait*, not *may wait forever*: past 24h pending, the job earns a cycle.
//
// Age comes from the filename's timestamp prefix, which every job-card writer
// stamps — no card mutation, and nothing to keep in sync. The block above uses
// an unstamped filename, whose age falls back to the mtime and so reads as
// young; this one is dated 2020.
void test("skipLowPriority buys \"an idle box doesn't spend an agent turn every tick on o...", async (t) => {
  const name = "2020-01-01T00-00-00-stale.intake.job.card";
  t.check(summary(await cycleOn({ [name]: intakeJob("Long overdue", { priority: "low" }) }, { skipLowPriority: true, act: finishing(name) })), {
    success: true,
    jobsProcessed: 1,
    jobsRemaining: 0,
    selected: 1,
    invoked: 1,
  });
});

// ## A deadline-triggered cycle takes a bounded batch, oldest first
//
// A box coming out of a long wedge can hold months of deferred work, and every
// pending job goes into one agent prompt. Dumping the whole backlog into a
// single turn is its own incident, so a cycle that runs *because* of the
// deadline admits at most the five oldest overdue jobs; the rest are still
// overdue on the next wakeup, so the queue drains at a pace rather than in one
// gulp.
//
// Oldest first, so the tail of a backlog can't be starved by newer arrivals —
// days 01–05 went, 06 and 07 wait. The next cycle finds them overdue and takes
// them.
void test("A box coming out of a long wedge can hold months of deferred work, and every...", async (t) => {
  const listJobs = async (box: TmpBox) =>
    (await fs.readdir(path.join(box.root, jobsDir))).filter((f) => f !== ".gitkeep").toSorted();
  const { after, ...first } = await cycleOn(overdueBacklog(), {
    skipLowPriority: true,
    act: finishingPromptedJobs,
    after: async (box, run) => ({ left: await listJobs(box), second: await run() }),
  });
  t.check(({ first: summary(first), ...after }), {
    first: {
      success: true,
      jobsProcessed: 5,
      jobsRemaining: 2,
      selected: 5,
      invoked: 1,
    },
    left: [
      "2020-01-06T00-00-00-b.contains-backfill.job.card",
      "2020-01-07T00-00-00-b.contains-backfill.job.card",
    ],
    second: {
      success: true,
      jobsProcessed: 2,
      jobsRemaining: 0,
      selected: 2,
    },
  });
});

// ## Normal work is never delayed by a low-priority backlog
//
// The cap applies only to the deadline path. As soon as any normal-priority job
// is pending the cycle runs on everything, as it always did — a pile of overdue
// low-priority cards must not push the normal job to a later wakeup. All eight
// are offered, and the normal job is listed first.
void test("The cap applies only to the deadline path.", async (t) => {
  const normal = "2026-06-01T00-00-00-now.question-followup.job.card";
  const { prompts, ...mixed } = await cycleOn(
    { ...overdueBacklog(), [normal]: followupJob("Real work") },
    { skipLowPriority: true },
  );
  const [offered] = prompts;
  invariant(offered, "the agent was offered a prompt");
  t.check(summary(mixed), { success: true, jobsProcessed: 0, jobsRemaining: 8, selected: 8, invoked: 1 });
  // The prompt is large generated text. The normal job appears, and before the first low-priority job.
  t.check(offered, str`${any(String)}${normal}${any(String)}2020-01-01T00-00-00-b${any(String)}`);
  t.check(offered.split("2020-01-01T00-00-00-b")[0], any(String).includes("2026-06-01T00-00-00-now"));
});

// ## A `todo-review-job` alone is processed under `skipLowPriority`, not stuck forever
//
// The wakeup `todo-review` sweep (`docs/implemented-plans/todo-annotation.md` Track 5b) is
// meant to be a "deterministic hook, not a hope" — but `bbx wakeup` always runs
// the reactor with `skipLowPriority: true`, and the discover stage above skips
// a cycle entirely when every pending job is low-priority. A `todo-review-job`
// that shipped as `priority: low` would then never get processed on an
// otherwise-idle box (no other jobs pending), and — being left pending —
// would suppress the next sweep's job too. `createTodoReviewJobTemplate`
// creates it `priority: normal` for exactly this reason: it must eventually
// reach an agent even when it's the only job around.
void test("The wakeup todo-review sweep (docs/implemented-plans/todo-annotation.md Track...", async (t) => {
  const review = "review.todo-review.job.card";
  const card = createTodoReviewJobTemplate({
    escalated: [],
    stirring: [{ locator: "a.doc.card:1", text: "Stirring item", detail: "started 2026-07-28" }],
    stale: [],
  });
  t.check(summary(await cycleOn({ [review]: card }, { skipLowPriority: true, act: finishing(review) })), {
    success: true,
    jobsProcessed: 1,
    jobsRemaining: 0,
    selected: 1,
    invoked: 1,
  });
});

// ## The processed count survives concurrent job additions
//
// The processed count is a set difference against the jobs the cycle set out to
// run — not `before - after`. An agent that consumes both originals while a new
// job lands concurrently still credits 2 processed (the old subtraction would
// have reported 1) and reports the newcomer as remaining.
void test("The processed count is a set difference against the jobs the cycle set out to...", async (t) => {
  const consumeBoth = async ({ boxRoot }: { boxRoot: string }) => {
    await finishing("a.question-followup.job.card", "b.question-followup.job.card")({ boxRoot });
    // A connector delivers a new job mid-cycle.
    await fs.writeFile(path.join(boxRoot, jobsDir, "new.intake.job.card"), intakeJob("Newcomer"));
    return { success: true };
  };
  t.check(
    summary(await cycleOn(
      { "a.question-followup.job.card": followupJob("Job A"), "b.question-followup.job.card": followupJob("Job B") },
      { skipLowPriority: false, act: consumeBoth },
    )),
    {
    success: true,
    jobsProcessed: 2,
    jobsRemaining: 1,
    selected: 2,
    invoked: 1,
  },
  );
});

// ## Engine: rotation within a run
//
// Five jobs of about 70 KB each: a batch prompt (160 KB) holds two. The agent
// finishes nothing, but its session succeeds, so the run goes on, and cycle 2
// sends the next two jobs instead of resending the first two. `maxCycles`
// still caps the run. (docs/implemented-plans/bounded-reactor-batches.md, Track C.)
void test("Rotation: each cycle of a run sends jobs it has not sent", async (t) => {
  const box3 = await makeTmpBox({ git: true });
  t.teardown(() => box3.cleanup());
  for (const n of ["j1", "j2", "j3", "j4", "j5"]) {
    await box3.write(`${jobsDir}/${n}.question-followup.job.card`, `${followupJob(`Job ${n}`)}${"x".repeat(70 * 1024)}\n`);
  }
  box3.commitAll("add jobs");

  const sent: string[][] = [];
  const recording = (succeed: boolean) => (opts: CreateAgentOptions) =>
    createFakeAgent({
      name: opts.name,
      act: async ({ prompt }) => {
        sent.push([...prompt.matchAll(/^### _bookkeeping\/jobs\/(j\d)\.question-followup\.job\.card/gm)].map((m) => m[1] ?? ""));
        return { success: succeed };
      },
    });

  const rotated = await runReactor({ boxRoot: box3.root, ...engineOverrides, createAgent: recording(true), maxCycles: 2 });
  t.check({ processed: rotated.jobsProcessed, remaining: rotated.jobsRemaining, sent }, {
    processed: 0,
    remaining: 5,
    sent: [["j1", "j2"], ["j3", "j4"]],
  });

  // ## Engine: a failed session stops the run
  //
  // An API error costs one session: the loop does not go on to the next jobs.

  sent.length = 0;
  const failed = await runReactor({ boxRoot: box3.root, ...engineOverrides, createAgent: recording(false), maxCycles: 3 });
  t.check({ success: failed.success, sent }, { success: false, sent: [["j1", "j2"]] });
});

// ## Processed is counted among the jobs sent
//
// Four jobs of about 70 KB: the batch prompt holds two. The agent finishes both
// it was sent; the cycle reports 2 processed, 2 remaining, 2 selected. The two
// deferred jobs were never tried, so they are not counted as failures.
void test("Processed is counted among the jobs sent", async (t) => {
  const big = (n: string) => `${followupJob(`Job ${n}`)}${"x".repeat(70 * 1024)}\n`;
  t.check(
    summary(await cycleOn(
      { "j1.question-followup.job.card": big("1"), "j2.question-followup.job.card": big("2"), "j3.question-followup.job.card": big("3"), "j4.question-followup.job.card": big("4") },
      { skipLowPriority: false, act: finishingPromptedJobs },
    )),
    { success: true, jobsProcessed: 2, jobsRemaining: 2, selected: 2, invoked: 1 },
  );
});
