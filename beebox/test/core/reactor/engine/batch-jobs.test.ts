// # The batch prompt is bounded
//
// One reactor batch once pasted a 300-item intake job's every ref into its
// prompt (about 3 MB), and the model refused it. A job now pastes refs up to
// `JOB_INLINE_BUDGET_BYTES` (40 KB) and lists the rest by path; the assembled
// prompt stays within `BATCH_PROMPT_BUDGET_BYTES` (160 KB), measured with its
// framing and separators; the oldest job is always sent, if need be by path;
// later jobs that do not fit wait. See docs/implemented-plans/bounded-reactor-batches.md,
// Track C.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import * as path from "node:path";
import { makeTmpBox, type TmpBox } from "../../../helpers/test-helpers.js";
import {
  BATCH_PROMPT_BUDGET_BYTES,
  describeJob,
  NOT_PASTED_HEADING,
  processBatchJobs,
  selectBatch,
  type JobForms,
} from "../../../../src/core/reactor/engine/batch-jobs.js";
import { buildReactorSystemPrompt } from "../../../../src/core/reactor/prompts.js";
import { createIntakeJobTemplate } from "../../../../src/schemas/intake-job.js";
import type { JobWithContent } from "../../../../src/core/reactor/types.js";
import { createFakeAgent } from "../../fake-agent.js";

const KB = 1024;

function job(relPath: string, content: string): JobWithContent {
  return { card: { file: path.basename(relPath), priority: "normal", createdAt: null }, relPath, content };
}

/** A card of about `kb` KB at `rel`. */
async function cardOf(box: TmpBox, { rel, kb }: { rel: string; kb: number }): Promise<void> {
  await box.write(rel, `---\ntitle: T\n---\n${"x".repeat(kb * KB - 20)}\n`);
}

/** The headings and listed lines of a description, without the pasted text. */
function outline(description: string): string[] {
  const [before = ""] = description.split("\n#### Instructions for ");
  return before.split("\n").filter((line) => line.startsWith("#") || line.startsWith("- ") || line.startsWith("This job"));
}

// ## A job pastes refs up to 40 KB and lists the rest
//
// Refs of 30, 20, and 5 KB: the 30 KB ref is pasted; the 20 KB ref would cross
// the per-job budget, so it and every ref after it (the 5 KB one too) are
// listed by path with their sizes.
void test("A job pastes refs up to 40 KB and lists the rest", async (t) => {
  const box = await makeTmpBox();
  t.teardown(() => box.cleanup());
  await cardOf(box, { rel: "_content/inbox/a.doc.card", kb: 30 });
  await cardOf(box, { rel: "_content/inbox/b.doc.card", kb: 20 });
  await cardOf(box, { rel: "_content/inbox/c.doc.card", kb: 5 });
  const content = createIntakeJobTemplate({ description: "Triage 3 inbox items", items: ["_content/inbox/a.doc.card", "_content/inbox/b.doc.card", "_content/inbox/c.doc.card"] });
  const description = (await describeJob(job("_bookkeeping/jobs/j.intake.job.card", content), box.root)).full;
  t.check(outline(description), [
    "### _bookkeeping/jobs/j.intake.job.card",
    "#### _content/inbox/a.doc.card",
    NOT_PASTED_HEADING,
    "- _content/inbox/b.doc.card (20 KB)",
    "- _content/inbox/c.doc.card (5 KB)",
  ]);
});

// ## A 300 KB job card is sent by path
//
// The oldest job is always sent. A hand-written card too large for the budget
// is named by path, with its type's instructions, in a prompt under 160 KB.
void test("A 300 KB job card is sent by path", async (t) => {
  const box = await makeTmpBox({ git: true });
  t.teardown(() => box.cleanup());
  const content = createIntakeJobTemplate({ description: "y".repeat(300 * KB), items: [] });
  const prompts: string[] = [];
  const agent = createFakeAgent({ name: "reactor-batch", act: async ({ prompt }) => {
    prompts.push(prompt);
    return { success: true };
  } });
  const outcome = await processBatchJobs({ jobs: [job("_bookkeeping/jobs/huge.intake.job.card", content)], boxRoot: box.root, dryRun: false, createAgent: () => agent });
  const [prompt = ""] = prompts;
  t.check(
    { outcome, underBudget: Buffer.byteLength(prompt) < BATCH_PROMPT_BUDGET_BYTES, outline: outline(prompt), instructions: prompt.includes("#### Instructions for intake-job") },
    {
      outcome: { success: true, selected: ["_bookkeeping/jobs/huge.intake.job.card"] },
      underBudget: true,
      outline: [
        "### _bookkeeping/jobs/huge.intake.job.card",
        "This job's card is too large to paste (300 KB). Open it before you start: _bookkeeping/jobs/huge.intake.job.card",
      ],
      instructions: true,
    },
  );
});

// ## Selection measures the assembled prompt
//
// First fit: descriptions of 100, 60, and 30 KB under a 160 KB budget send 100
// and 30; 60 waits. Selection measures the prompt it would assemble, so the
// framing and the separator between descriptions count: two descriptions
// that fill the budget exactly by themselves do not both fit once the framing
// or the `\n\n` between them is added.
void test("Selection measures the assembled prompt", async (t) => {
  const forms = (relPath: string, bytes: number): JobForms => {
    const full = "d".repeat(bytes);
    return { relPath, full, listed: full, byPath: relPath };
  };
  const plain = (selected: { description: string }[]) => selected.map((s) => s.description).join("\n\n");
  const framed = (selected: { description: string }[]) => `Please process:\n\n${plain(selected)}\n\nDone.`;
  t.check(
    {
      firstFit: selectBatch([forms("a", 100 * KB), forms("b", 60 * KB), forms("c", 30 * KB)], { assemble: plain, budget: 160 * KB }),
      separator: selectBatch([forms("a", 80 * KB), forms("b", 80 * KB)], { assemble: plain, budget: 160 * KB }),
      framing: selectBatch([forms("a", 80 * KB), forms("b", 80 * KB - 2)], { assemble: framed, budget: 160 * KB }),
    },
    {
      firstFit: { selected: [{ relPath: "a", description: "d".repeat(100 * KB) }, { relPath: "c", description: "d".repeat(30 * KB) }], deferred: ["b"] },
      separator: { selected: [{ relPath: "a", description: "d".repeat(80 * KB) }], deferred: ["b"] },
      framing: { selected: [{ relPath: "a", description: "d".repeat(80 * KB) }], deferred: ["b"] },
    },
  );
});

// ## A prompt over the budget starts no session
//
// Only a job type whose instructions alone exceed the budget can produce one:
// even sent by path, the job carries its instructions. That is a broken
// invariant; the batch throws a typed error and no agent is invoked. Shown at
// scale: the intake-job instructions (a few KB) against a 1 KB budget.
void test("A prompt over the budget starts no session", async (t) => {
  const box = await makeTmpBox({ git: true });
  t.teardown(() => box.cleanup());
  const agent = createFakeAgent({ name: "reactor-batch", act: async () => ({ success: true }) });
  const content = createIntakeJobTemplate({ description: "One", items: [] });
  const thrown = await processBatchJobs({ jobs: [job("_bookkeeping/jobs/x.intake.job.card", content)], boxRoot: box.root, dryRun: false, createAgent: () => agent, promptBudget: KB })
    .then(() => "no error", (e: unknown) => (e instanceof Error ? e.name : "not an Error"));
  t.check({ thrown, invocations: agent.invocations }, { thrown: "BatchPromptTooLargeError", invocations: [] });
});

// ## Dry run prints the selection
//
// It names how many jobs it would send, the prompt's size, and the deferred
// jobs, each on a `deferred to a later cycle` line. The second job is not an
// intake job, so the prompt budget alone defers it.
void test("Dry run prints the selection", async (t) => {
  const box = await makeTmpBox({ git: true });
  t.teardown(() => box.cleanup());
  const big = (name: string, type: "intake" | "question-followup") =>
    job(`_bookkeeping/jobs/${name}.${type}.job.card`, `${createIntakeJobTemplate({ description: name, items: [] })}${"w".repeat(100 * KB)}\n`);
  const log: string[] = [];
  const outcome = await processBatchJobs({
    jobs: [big("first", "intake"), big("second", "question-followup")],
    boxRoot: box.root,
    dryRun: true,
    onLog: (text) => log.push(text),
    createAgent: () => createFakeAgent({ name: "reactor-batch", act: async () => ({ success: true }) }),
  });
  t.check({ outcome, lines: log.slice(0, 2) }, {
    outcome: { success: true, selected: ["_bookkeeping/jobs/first.intake.job.card"] },
    lines: [
      "  deferred to a later cycle: _bookkeeping/jobs/second.question-followup.job.card\n",
      "\n[DRY RUN] Would send 1 job(s), 100 KB prompt; 1 deferred.\n",
    ],
  });
});

// ## A batch carries at most one intake job
//
// Jobs are intake A, question-followup B, intake C, all small enough to fit the
// byte budget together. The budget counts bytes, but a session runs out of
// turns first, so A and B are sent and the later intake job C waits.
void test("A batch carries at most one intake job", async (t) => {
  const forms = (relPath: string): JobForms => ({ relPath, full: "d", listed: "d", byPath: relPath });
  const plain = (selected: { description: string }[]) => selected.map((s) => s.description).join("\n\n");
  t.check(
    selectBatch(
      [forms("_bookkeeping/jobs/a.intake.job.card"), forms("_bookkeeping/jobs/b.question-followup.job.card"), forms("_bookkeeping/jobs/c.intake.job.card")],
      { assemble: plain, budget: 160 * KB },
    ),
    {
      selected: [
        { relPath: "_bookkeeping/jobs/a.intake.job.card", description: "d" },
        { relPath: "_bookkeeping/jobs/b.question-followup.job.card", description: "d" },
      ],
      deferred: ["_bookkeeping/jobs/c.intake.job.card"],
    },
  );
});

// ## What the agent is told
//
// The system prompt no longer says referenced files need not be read: it names
// the "Not pasted in" heading and the job given by path.
void test("What the agent is told", async (t) => {
  const context = buildReactorSystemPrompt().split("## Your Context\n\n")[1]?.split("\n\n## ")[0];
  t.check(context, "Each job below has its type's instructions. Referenced files are pasted in under the job, except those listed under \"Not pasted in (open these with your tools)\": open each listed path before you act on it. A job given by path must be opened first. The rules and the agent guide are loaded; you do not need to re-read pasted material. How the box and its cards work is in the agent guide (see ABOUT_CARDS).");
});
