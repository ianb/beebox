# Run summaries: what a scheduled run says about itself

A scheduled run ends with a summary the task writes itself: a one-line
headline, an optional short Markdown body, optional notes, and a priority
(`normal` or `attention`). The runner sets `BBX_SUMMARY_FILE` on every `runs:`
command; `bbx run-summary` (or the task, in-process) writes there, and after
the run the runner appends one entry to the schedule's run history. The
history is machine-local state next to the schedule's timing and keeps the
last 20 runs (`src/core/schedule/summary.ts`).

```ts setup
import * as fs from "node:fs/promises";
import { runTick } from "../../../src/cli/commands/tick.js";
import {
  appendRunHistory,
  loadRunHistory,
  normalizeRunSummary,
  reportRunSummary,
} from "../../../src/core/schedule/summary.js";
import { chatReviewRunSummary } from "../../../src/core/chat/review/run-summary.js";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";

process.env.BBX_ENGINE_AVAILABILITY_FILE = "/nonexistent/engine-availability.json";

/** The schedule copies `_tmp/summary.json` to its summary file when present, and fails when `_tmp/fail` exists. */
const REPORT = `---
cron: "0 0 1 1 *"
runs: >-
  { [ ! -f _tmp/summary.json ] || cp _tmp/summary.json "$BBX_SUMMARY_FILE"; } &&
  [ ! -f _tmp/fail ]
---
`;

async function tick(box) {
  const result = await runTick(box.root, { quiet: true, script: "report", force: true });
  return result.scripts[0]?.status;
}

/** A history entry with its varying time and duration masked. */
const masked = ({ ts, durationMs, ...rest }) => rest;
```

## Each run lands in the history, with the summary it wrote

The first run writes a summary; the history entry carries it with the result
and the trigger. The second run writes none, and its entry says only how it
ended. A failed run keeps its error.

```ts
const box = await makeTmpBox({ git: true });
await box.write("_config/schedules/report.scheduled-script.card", REPORT);
box.commitAll("setup");
await box.write("_tmp/summary.json", JSON.stringify({
  headline: "Fetched 3 receipts",
  body: "- 2 from email\n- 1 from Drive",
  priority: "normal",
}));
await tick(box)
=> ran

(await loadRunHistory(box.root, "report")).map(masked)
=> [
  {
    result: "success",
    triggeredBy: "schedule",
    summary: { headline: "Fetched 3 receipts", body: "- 2 from email\n- 1 from Drive", priority: "normal" }
  }
]
```

```ts continue
await fs.rm(box.path("_tmp/summary.json"));
await box.write("_tmp/fail", "");
await tick(box)
=> error

masked((await loadRunHistory(box.root, "report")).at(-1))
=> { result: "failure", triggeredBy: "schedule", error: «*» }
```

A run that stops because it found nothing to do records why, so the
dashboard can say "nothing to do" instead of showing a wait:

```ts continue
await fs.rm(box.path("_tmp/fail"));
await box.write("_config/schedules/report.scheduled-script.card", `---
cron: "0 0 1 1 *"
runs: >-
  echo '{"reason":"no-change"}' > "$BBX_DEFER_FILE"; exit 75
---
`);
box.commitAll("defer");
await tick(box)
=> skipped

masked((await loadRunHistory(box.root, "report")).at(-1))
=> { result: "deferred", triggeredBy: "schedule", error: "no-change: nothing to do", deferReason: "no-change" }
```

```ts cleanup
await box.cleanup();
```

## The history keeps the last 20 runs

```ts
const box = await makeTmpBox();
for (let i = 1; i <= 22; i++) {
  await appendRunHistory(box.root, {
    scriptName: "busy",
    entry: { ts: `2026-10-07T00:00:${String(i).padStart(2, "0")}Z`, result: "success", durationMs: 1, triggeredBy: "schedule" },
  });
}
const kept = await loadRunHistory(box.root, "busy");
[kept.length, kept[0].ts, kept.at(-1).ts]
=> [20, "2026-10-07T00:00:03Z", "2026-10-07T00:00:22Z"]
```

A run recorded again at the same time (the tick re-records a success as a
failure when post-success housekeeping throws) replaces its entry and keeps
the summary it wrote:

```ts continue
await appendRunHistory(box.root, {
  scriptName: "busy",
  entry: { ts: "2026-10-07T00:00:22Z", result: "success", durationMs: 1, triggeredBy: "schedule", summary: { headline: "Done", priority: "normal" } },
});
await appendRunHistory(box.root, {
  scriptName: "busy",
  entry: { ts: "2026-10-07T00:00:22Z", result: "failure", durationMs: 1, triggeredBy: "schedule", error: "could not delete the once card" },
});
const after = await loadRunHistory(box.root, "busy");
[after.length, after.at(-1)]
=> [20, { ts: "2026-10-07T00:00:22Z", result: "failure", durationMs: 1, triggeredBy: "schedule", error: "could not delete the once card", summary: { headline: "Done", priority: "normal" } }]
```

Entries written before the history recorded `deferReason` still name it as
the error's prefix, and reading the history recovers it:

```ts continue
await fs.appendFile(
  box.path("_config/schedules/.state/busy.runs.jsonl"),
  JSON.stringify({ ts: "2026-10-07T00:00:23Z", result: "deferred", durationMs: 1, triggeredBy: "schedule", error: "no-change: nothing to do" }) + "\n",
);
(await loadRunHistory(box.root, "busy")).at(-1).deferReason
=> no-change
```

```ts cleanup
await box.cleanup();
```

## A summary is cut to its limits

The headline is one line of at most 120 characters; the body is at most 1 KB
and the notes 4 KB. The writer reports what it cut, so `bbx run-summary` can
warn the task.

```ts
const { summary, cut } = normalizeRunSummary({
  headline: `Line one\nline two ${"x".repeat(200)}`,
  body: "b".repeat(2000),
  priority: "attention",
});
[summary.headline.length, summary.headline.slice(0, 18), summary.body.length, cut]
=> [120, "Line one line two ", 1024, ["headline (over 120 characters)", "body (over 1024 bytes)"]]
```

## Outside a scheduled run nothing is listening

With no `BBX_SUMMARY_FILE` in the environment, reporting returns null and
writes nothing; `bbx run-summary` prints the summary instead.

```ts
await reportRunSummary({}, { headline: "Done", priority: "normal" })
=> null
```

## Chat review's summary

Chat review is the first task to write one. The headline says what it
reviewed, titled, and skipped; the body lists the skips by reason; the
bookkeeping goes in the notes. A quiet night is `normal`.

```ts
const counts = {
  reviewed: 2, titled: 3, titlesKept: 1, alreadyApplied: 0, bootstrapped: 0, rewritten: 0,
  reviewerFailures: 0, sessionErrors: 0, exhausted: 0, rejected: [],
  missingTranscripts: 11, deferredActive: 0, belowThreshold: 1, belowTitleThreshold: 20,
  tooFewTurns: 4, foreignOrigin: 0, overflow: 0,
};
chatReviewRunSummary(counts)
=> {
  headline: "Reviewed 2 chats, titled 3, skipped 35",
  priority: "normal",
  body: "**Skipped**\n- not enough new text for a title (under 400 characters): 20\n- too few user turns: 4\n- transcript gone: 11",
  notes: "- titles kept by the freshness check: 1"
}
```

A reviewer failure makes the run `attention` and leads the body:

```ts continue
chatReviewRunSummary({ ...counts, reviewerFailures: 1, belowTitleThreshold: 0, tooFewTurns: 0, missingTranscripts: 0, titlesKept: 0 })
=> {
  headline: "Reviewed 2 chats, titled 3",
  priority: "attention",
  body: "**Problems**\n- reviewer failures: 1"
}
```

A run with nothing to do says so:

```ts continue
chatReviewRunSummary({ ...counts, reviewed: 0, titled: 0, titlesKept: 0, belowTitleThreshold: 0, tooFewTurns: 0, missingTranscripts: 0 }).headline
=> No chats to review
```

## An agent step in a scheduled run is told to write one

A scheduled `bbx procedure run` passes `BBX_SUMMARY_FILE` to its agent steps,
and the procedure's context block names the schedule and the command. Outside
a schedule the block says nothing about it.

```ts
const { buildContextBlock } = await import("../../../src/core/procedure/engine/phase.js");
const box = await makeTmpBox();
const base = { boxRoot: box.root, runCardPath: "run.card", stepId: "review", procedurePath: "p.procedure.card" };
buildContextBlock({ ...base, scheduleName: "todo-review" }).split("<scheduled-run>\n")[1].split("\n")[0]
=> This procedure is running as the scheduled task "todo-review". The boxholder sees each run's summary on the dashboard. Before you finish, write one:

buildContextBlock(base).includes("<scheduled-run>")
=> false
```

```ts cleanup
await box.cleanup();
```
