// # Run summaries: what a scheduled run says about itself
//
// A scheduled run ends with a summary the task writes itself: a one-line
// headline, an optional short Markdown body, optional notes, and a priority
// (`normal` or `attention`). The runner sets `BBX_SUMMARY_FILE` on every `runs:`
// command; `bbx run-summary` (or the task, in-process) writes there, and after
// the run the runner appends one entry to the schedule's run history. The
// history is machine-local state next to the schedule's timing and keeps the
// last 20 runs (`src/core/schedule/summary.ts`).

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any, anything, str } from "@ianbicking/tap-check/check";
import * as fs from "node:fs/promises";
import { runTick } from "../../../src/cli/commands/tick.js";
import {
  appendRunHistory,
  loadRunHistory,
  normalizeRunSummary,
  reportRunSummary,
} from "../../../src/core/schedule/summary.js";
import type { RunHistoryEntry } from "../../../src/core/schedule/summary.js";
import { invariant } from "../../../src/shared/invariant.js";
import { chatReviewRunSummary } from "../../../src/core/chat/review/run-summary.js";
import { makeTmpBox } from "../../helpers/test-helpers.js";
import type { TmpBox } from "../../helpers/test-helpers.js";

process.env.BBX_ENGINE_AVAILABILITY_FILE = "/nonexistent/engine-availability.json";

/** The schedule copies `_tmp/summary.json` to its summary file when present, and fails when `_tmp/fail` exists. */
const REPORT = `---
cron: "0 0 1 1 *"
runs: >-
  { [ ! -f _tmp/summary.json ] || cp _tmp/summary.json "$BBX_SUMMARY_FILE"; } &&
  [ ! -f _tmp/fail ]
---
`;

async function tick(box: TmpBox) {
  const result = await runTick(box.root, { quiet: true, script: "report", force: true });
  return result.scripts[0]?.status;
}

/** A history entry with its varying time and duration masked. */
const masked = (entry: RunHistoryEntry | undefined) => {
  invariant(entry, "the run left a history entry");
  const { ts: _ts, durationMs: _durationMs, ...rest } = entry;
  return rest;
};

// ## Each run lands in the history, with the summary it wrote
//
// The first run writes a summary; the history entry carries it with the result
// and the trigger. The second run writes none, and its entry says only how it
// ended. A failed run keeps its error.
void test("The first run writes a summary; the history entry carries it with the result...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L57
  const box = await makeTmpBox({ git: true });
  await box.write("_config/schedules/report.scheduled-script.card", REPORT);
  box.commitAll("setup");
  await box.write("_tmp/summary.json", JSON.stringify({
    headline: "Fetched 3 receipts",
    body: "- 2 from email\n- 1 from Drive",
    priority: "normal",
  }));
  t.check(await tick(box), "ran");

  // doctest:L68
  t.check((await loadRunHistory(box.root, "report")).map(masked), [
    {
      result: "success",
      triggeredBy: "schedule",
      summary: {
        headline: "Fetched 3 receipts",
        body: `- 2 from email
- 1 from Drive`,
        priority: "normal",
      },
    },
  ]);

  // doctest:L79
  await fs.rm(box.path("_tmp/summary.json"));
  await box.write("_tmp/fail", "");
  t.check(await tick(box), "error");

  // doctest:L84
  t.check(masked((await loadRunHistory(box.root, "report")).at(-1)), {
    result: "failure",
    triggeredBy: "schedule",
    error: anything(),
  });

  // A run that stops because it found nothing to do records why, so the
  // dashboard can say "nothing to do" instead of showing a wait:

  // doctest:L92
  await fs.rm(box.path("_tmp/fail"));
  await box.write("_config/schedules/report.scheduled-script.card", `---
cron: "0 0 1 1 *"
runs: >-
  echo '{"reason":"no-change"}' > "$BBX_DEFER_FILE"; exit 75
---
`);
  box.commitAll("defer");
  t.check(await tick(box), "skipped");

  // doctest:L103
  t.check(masked((await loadRunHistory(box.root, "report")).at(-1)), {
    result: "deferred",
    triggeredBy: "schedule",
    error: "no-change: nothing to do",
    deferReason: "no-change",
  });
});

// ## The history keeps the last 20 runs
void test("The history keeps the last 20 runs", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L114
  const box = await makeTmpBox();
  for (let i = 1; i <= 22; i++) {
    await appendRunHistory(box.root, {
      scriptName: "busy",
      entry: { ts: `2026-10-07T00:00:${String(i).padStart(2, "0")}Z`, result: "success", durationMs: 1, triggeredBy: "schedule" },
    });
  }
  const kept = await loadRunHistory(box.root, "busy");
  t.check([kept.length, kept[0]?.ts, kept.at(-1)?.ts], [
    20,
    "2026-10-07T00:00:03Z",
    "2026-10-07T00:00:22Z",
  ]);

  // A run recorded again at the same time (the tick re-records a success as a
  // failure when post-success housekeeping throws) replaces its entry and keeps
  // the summary it wrote:

  // doctest:L131
  await appendRunHistory(box.root, {
    scriptName: "busy",
    entry: { ts: "2026-10-07T00:00:22Z", result: "success", durationMs: 1, triggeredBy: "schedule", summary: { headline: "Done", priority: "normal" } },
  });
  await appendRunHistory(box.root, {
    scriptName: "busy",
    entry: { ts: "2026-10-07T00:00:22Z", result: "failure", durationMs: 1, triggeredBy: "schedule", error: "could not delete the once card" },
  });
  const after = await loadRunHistory(box.root, "busy");
  t.check([after.length, after.at(-1)], [
    20,
    {
      ts: "2026-10-07T00:00:22Z",
      result: "failure",
      durationMs: 1,
      triggeredBy: "schedule",
      error: "could not delete the once card",
      summary: {
        headline: "Done",
        priority: "normal",
      },
    },
  ]);

  // Entries written before the history recorded `deferReason` still name it as
  // the error's prefix, and reading the history recovers it:

  // doctest:L148
  await fs.appendFile(
    box.path("_config/schedules/.state/busy.runs.jsonl"),
    JSON.stringify({ ts: "2026-10-07T00:00:23Z", result: "deferred", durationMs: 1, triggeredBy: "schedule", error: "no-change: nothing to do" }) + "\n",
  );
  t.check((await loadRunHistory(box.root, "busy")).at(-1)?.deferReason, "no-change");
});

// ## A summary is cut to its limits
//
// The headline is one line of at most 120 characters; the body is at most 1 KB
// and the notes 4 KB. The writer reports what it cut, so `bbx run-summary` can
// warn the task.
void test("The headline is one line of at most 120 characters; the body is at most 1 KB...", async (t) => {
  // doctest:L167
  const { summary, cut } = normalizeRunSummary({
    headline: `Line one\nline two ${"x".repeat(200)}`,
    body: "b".repeat(2000),
    priority: "attention",
  });
  t.check([summary.headline.length, summary.headline.slice(0, 18), summary.body?.length, cut], [
    120,
    "Line one line two ",
    1024,
    [
      "headline (over 120 characters)",
      "body (over 1024 bytes)",
    ],
  ]);
});

// ## Outside a scheduled run nothing is listening
//
// With no `BBX_SUMMARY_FILE` in the environment, reporting returns null and
// writes nothing; `bbx run-summary` prints the summary instead.
void test("With no BBXSUMMARYFILE in the environment, reporting returns null and writes...", async (t) => {
  // doctest:L182
  t.check(await reportRunSummary({}, { headline: "Done", priority: "normal" }), null);
});

// ## Chat review's summary
//
// Chat review is the first task to write one. The headline says what it
// reviewed, titled, and skipped; the body lists the skips by reason; the
// bookkeeping goes in the notes. A quiet night is `normal`.
void test("Chat review is the first task to write one.", async (t) => {
  // doctest:L193
  const counts = {
    reviewed: 2, titled: 3, titlesKept: 1, alreadyApplied: 0, bootstrapped: 0, rewritten: 0,
    reviewerFailures: 0, sessionErrors: 0, exhausted: 0, rejected: [],
    missingTranscripts: 11, deferredActive: 0, belowThreshold: 1, belowTitleThreshold: 20,
    tooFewTurns: 4, foreignOrigin: 0, overflow: 0,
  };
  t.check(chatReviewRunSummary(counts), {
    headline: "Reviewed 2 chats, titled 3, skipped 35",
    priority: "normal",
    body: `**Skipped**
- not enough new text for a title (under 400 characters): 20
- too few user turns: 4
- transcript gone: 11`,
    notes: "- titles kept by the freshness check: 1",
  });

  // A reviewer failure makes the run `attention` and leads the body:

  // doctest:L211
  t.check(chatReviewRunSummary({ ...counts, reviewerFailures: 1, belowTitleThreshold: 0, tooFewTurns: 0, missingTranscripts: 0, titlesKept: 0 }), {
    headline: "Reviewed 2 chats, titled 3",
    priority: "attention",
    body: `**Problems**
- reviewer failures: 1`,
  });

  // A run with nothing to do says so:

  // doctest:L222
  t.check(chatReviewRunSummary({ ...counts, reviewed: 0, titled: 0, titlesKept: 0, belowTitleThreshold: 0, tooFewTurns: 0, missingTranscripts: 0 }).headline, "No chats to review");
});

// ## An agent step in a scheduled run is told to write one
//
// A scheduled `bbx procedure run` passes `BBX_SUMMARY_FILE` to its agent steps,
// and the procedure's context block names the schedule and the command. Outside
// a schedule the block says nothing about it.
void test("A scheduled bbx procedure run passes BBXSUMMARYFILE to its agent steps, and t...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L233
  const { buildContextBlock } = await import("../../../src/core/procedure/engine/phase.js");
  const box = await makeTmpBox();
  const base = { boxRoot: box.root, runCardPath: "run.card", stepId: "review", procedurePath: "p.procedure.card" };
  // The date is the wall clock.
  const date = any(String).matches(/^\d{4}-\d{2}-\d{2}$/);
  t.check(buildContextBlock({ ...base, scheduleName: "todo-review" }), str`# Context

Current date: ${date}
Procedure run: run.card
Step: review

<scheduled-run>
This procedure is running as the scheduled task "todo-review". The boxholder sees each run's summary on the dashboard. Before you finish, write one:

    bbx run-summary "<one line: what this run did>" --body "<a few Markdown lines: what changed, what was skipped and why>"

Add \`--priority attention\` only when the boxholder should look at this run (something failed, needs a decision, or is unusual); a routine run is \`normal\`, the default. Longer detail goes in \`--notes\`. A later \`bbx run-summary\` in the same run replaces an earlier one.
</scheduled-run>`);

  // doctest:L239
  t.check(buildContextBlock(base), str`# Context

Current date: ${date}
Procedure run: run.card
Step: review`);
});
