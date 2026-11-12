// # Reactor Unit Tests
//
// Tests for the reactor's pure functions: prompt building, job discovery,
// procedure detection, and job description building.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any, isoDate, not, str } from "@ianbicking/tap-check/check";
import {
  buildReactorSystemPrompt,
  buildReactorUserPrompt,
} from "../../src/core/reactor/prompts.js";
import { findJobCards } from "../../src/core/reactor/job-discovery.js";
import { describeJob } from "../../src/core/reactor/engine/batch-jobs.js";
import { createIntakeJobTemplate } from "../../src/schemas/intake-job.js";
import { makeTmpBox } from "../helpers/test-helpers.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";

// ## buildReactorSystemPrompt
//
// ### No absolute filesystem paths
//
// The system prompt must never embed the box's absolute path — agent-visible
// text stays box-relative (`docs/implemented-plans/one-root-box-layout.md`, criterion 4).
void test("The system prompt must never embed the box's absolute path — agent-visible te...", async (t) => {
  // The prompt is large generated text, so the check is on what it must not hold.
  t.check(buildReactorSystemPrompt(), not(any(String).matches(/\/(Users|home|tmp|private)\//)));
});

// ## buildReactorUserPrompt
//
// ### Formats job list with descriptions
void test("Formats job list with descriptions", async (t) => {
  const prompt = buildReactorUserPrompt(
    ["_bookkeeping/jobs/task1.job.card", "_bookkeeping/jobs/task2.job.card"],
    { jobDescriptions: ["### _bookkeeping/jobs/task1.job.card\n```\ndo thing 1\n```",
     "### _bookkeeping/jobs/task2.job.card\n```\ndo thing 2\n```"] },
  );
  t.check(
    prompt,
    `Please process the following 2 job(s):

### _bookkeeping/jobs/task1.job.card
\`\`\`
do thing 1
\`\`\`

### _bookkeeping/jobs/task2.job.card
\`\`\`
do thing 2
\`\`\`

Process each job according to its type's instructions, then call \`bbx finish\` for each one when done.`,
  );
});

// ### Ambient todo line, when given, leads the prompt
void test("Ambient todo line, when given, leads the prompt", async (t) => {
  const promptWithAmbient = buildReactorUserPrompt(
    ["_bookkeeping/jobs/only.job.card"],
    {
      jobDescriptions: ["### _bookkeeping/jobs/only.job.card\n```\nsolo task\n```"],
      ambientLine: "3 todos now (1 overdue) — `bbx query todos`",
    },
  );
  t.check(
    promptWithAmbient,
    `3 todos now (1 overdue) — \`bbx query todos\`

Please process the following 1 job(s):

### _bookkeeping/jobs/only.job.card
\`\`\`
solo task
\`\`\`

Process each job according to its type's instructions, then call \`bbx finish\` for each one when done.`,
  );
});

// ### No ambient line, when omitted or null
void test("No ambient line, when omitted or null", async (t) => {
  const promptNoAmbient = buildReactorUserPrompt(
    ["_bookkeeping/jobs/only.job.card"],
    { jobDescriptions: ["### _bookkeeping/jobs/only.job.card\n```\nsolo task\n```"], ambientLine: null },
  );
  t.check(
    promptNoAmbient,
    `Please process the following 1 job(s):

### _bookkeeping/jobs/only.job.card
\`\`\`
solo task
\`\`\`

Process each job according to its type's instructions, then call \`bbx finish\` for each one when done.`,
  );
});

// ## findJobCards
//
// ### Finds job cards and sorts by priority
void test("Finds job cards and sorts by priority", async (t) => {
  const box = await makeTmpBox({ git: true });
  const jobsDir = path.join(box.root, "_bookkeeping/jobs");
  await box.write("_bookkeeping/jobs/task-a.job.card", "---\npriority: low\n---\nLow A");
  await box.write("_bookkeeping/jobs/task-b.job.card", "---\npriority: normal\n---\nNormal B");
  await box.write("_bookkeeping/jobs/task-c.job.card", "---\npriority: low\n---\nLow C");

  const cards = await findJobCards(jobsDir);
  t.check(cards, [
    { file: "task-b.job.card", priority: "normal", createdAt: isoDate() },
    { file: "task-a.job.card", priority: "low", createdAt: isoDate() },
    { file: "task-c.job.card", priority: "low", createdAt: isoDate() },
  ]);

  await box.cleanup();
});

// ### Age comes from the filename stamp, and a stamp that isn't a date is no stamp
//
// `createdAt` is what the reactor's low-priority deadline and the stalled-jobs
// health check both read. Every job-card writer stamps the filename, in UTC; an
// unstamped name falls back to the file's mtime. A stamp that only looks like a
// date is rejected rather than normalized — `Date.UTC` would happily roll month
// 99 into a later year and hand a mangled filename a real, wrong age.
void test("createdAt is what the reactor's low-priority deadline and the stalled-jobs he...", async (t) => {
  const box = await makeTmpBox({ git: true });
  const jobsDir = path.join(box.root, "_bookkeeping/jobs");
  await box.write("_bookkeeping/jobs/2026-08-18T09-30-00-gmail.intake.job.card", "---\n---\nStamped to the second");
  await box.write("_bookkeeping/jobs/2026-08-18T09-30.contains-backfill.job.card", "---\n---\nStamped to the minute");
  await box.write("_bookkeeping/jobs/2026-99-99T99-99-bad.intake.job.card", "---\n---\nNot a date");
  await box.write("_bookkeeping/jobs/handwritten.job.card", "---\n---\nNo stamp at all");

  const byFile = new Map((await findJobCards(jobsDir)).map((c) => [c.file, c.createdAt]));
  t.check(Object.fromEntries(byFile), {
    "2026-08-18T09-30-00-gmail.intake.job.card": new Date("2026-08-18T09:30:00.000Z"),
    "2026-08-18T09-30.contains-backfill.job.card": new Date("2026-08-18T09:30:00.000Z"),
    "2026-99-99T99-99-bad.intake.job.card": isoDate(),
    "handwritten.job.card": isoDate(),
  });

  // The two that carry no usable stamp fall back to the mtime, so they read as
  // newly written rather than as ancient or as unknown.
  const fallbacks = ["2026-99-99T99-99-bad.intake.job.card", "handwritten.job.card"];
  t.check(
    fallbacks.map((f) => Date.now() - (byFile.get(f)?.getTime() ?? 0)),
    [any(Number).below(60_000), any(Number).below(60_000)],
  );

  // The two that carry no usable stamp fall back to the mtime, so they read as
  // newly written rather than as ancient or as unknown.

  await box.cleanup();
});

// ### Type filter only matches typed suffix
void test("Type filter only matches typed suffix", async (t) => {
  const box = await makeTmpBox({ git: true });
  const jobsDir = path.join(box.root, "_bookkeeping/jobs");
  await box.write("_bookkeeping/jobs/msg1.digest.job.card", "---\nconnector: rss\n---\nDigest");
  await box.write("_bookkeeping/jobs/sweep.intake.job.card", "---\nconnector: gmail\n---\nIntake");

  const digestOnly = await findJobCards(jobsDir, { typeFilter: "digest" });
  t.check(digestOnly, [{ file: "msg1.digest.job.card", priority: "normal", connector: "rss", createdAt: isoDate() }]);

  const all = await findJobCards(jobsDir);
  t.check(all, [
    { file: "msg1.digest.job.card", priority: "normal", connector: "rss", createdAt: isoDate() },
    { file: "sweep.intake.job.card", priority: "normal", connector: "gmail", createdAt: isoDate() },
  ]);

  await box.cleanup();
});

// ### Connector filter drops jobs whose connector field does not match
//
// A job no connector made (here, a full wakeup's inbox triage) matches no
// connector filter:
void test("A job no connector made (here, a full wakeup's inbox triage) matches no conne...", async (t) => {
  const box = await makeTmpBox({ git: true });
  const jobsDir = path.join(box.root, "_bookkeeping/jobs");
  await box.write("_bookkeeping/jobs/email.intake.job.card", "---\nconnector: gmail\n---\nEmail triage");
  await box.write("_bookkeeping/jobs/feed.digest.job.card", "---\nconnector: rss\n---\nDigest");
  await box.write("_bookkeeping/jobs/inbox.intake.job.card", "---\npriority: normal\n---\nInbox triage");

  const gmailOnly = await findJobCards(jobsDir, { connectorFilter: "gmail" });
  t.check(gmailOnly.map((c) => c.file), [
    "email.intake.job.card",
  ]);

  const rssOnly = await findJobCards(jobsDir, { connectorFilter: "rss" });
  t.check(rssOnly.map((c) => c.file), [
    "feed.digest.job.card",
  ]);

  // Other jobs stay put for a future run that does match them. Each card's
  // connector comes back with it; the unscoped job has none (the scheduler
  // pass's job check reads that):
  const noFilter = await findJobCards(jobsDir);
  t.check(noFilter, [
    { file: "email.intake.job.card", priority: "normal", connector: "gmail", createdAt: isoDate() },
    { file: "feed.digest.job.card", priority: "normal", connector: "rss", createdAt: isoDate() },
    { file: "inbox.intake.job.card", priority: "normal", createdAt: isoDate() },
  ]);

  await box.cleanup();
});

// ### Frontmatter job cards: priority and connector come from YAML fields
//
// Current job cards are YAML frontmatter, not XML — discovery reads the
// `priority:` and `connector:` fields (this regressed once when discovery
// only grepped XML attributes, silently dropping every frontmatter job
// from filtered runs):
void test("Current job cards are YAML frontmatter, not XML — discovery reads the priorit...", async (t) => {
  const box = await makeTmpBox({ git: true });
  const jobsDir = path.join(box.root, "_bookkeeping/jobs");
  await box.write("_bookkeeping/jobs/y1.intake.job.card", "---\nconnector: gmail\npriority: low\ndescription: Triage 1 inbox item\nitems:\n  - ref: _content/inbox/a.doc.card\n---\n");
  await box.write("_bookkeeping/jobs/y2.intake.job.card", "---\nconnector: rss\npriority: normal\ndescription: Triage 0 items\nitems: []\n---\n");

  const gmailOnly = await findJobCards(jobsDir, { connectorFilter: "gmail" });
  t.check(gmailOnly, [{ file: "y1.intake.job.card", priority: "low", connector: "gmail", createdAt: isoDate() }]);

  await box.cleanup();
});

// ### Empty directory returns empty array
void test("Empty directory returns empty array", async (t) => {
  const box = await makeTmpBox({ git: true });
  await fs.mkdir(path.join(box.root, "_bookkeeping/jobs"), { recursive: true });
  const cards = await findJobCards(path.join(box.root, "_bookkeeping/jobs"));
  t.check(cards, []);

  await box.cleanup();
});

// ### Non-existent directory returns empty array
void test("Non-existent directory returns empty array", async (t) => {
  const cards = await findJobCards("/tmp/nonexistent-reactor-test-dir");
  t.check(cards, []);
});

// ## describeJob
//
// ### Includes the job card and priority label (no xml fence)
void test("Includes the job card and priority label (no xml fence)", async (t) => {
  const desc = (await describeJob(
    {
      card: { file: "task.intake.job.card", priority: "low", createdAt: null },
      relPath: "_bookkeeping/jobs/task.intake.job.card",
      content: createIntakeJobTemplate({
        connector: "rss",
        description: "Do something",
        items: [],
        priority: "low",
      }),
    },
    "/tmp/fake-box",
  )).full;
  // The schema instructions after the heading are large generated text, so only
  // their heading is checked; the card section above them is exact.
  t.check(
    desc,
    str`${[
      "### _bookkeeping/jobs/task.intake.job.card *(low priority)*",
      "```",
      "---",
      "connector: rss",
      "priority: low",
      "description: Do something",
      "items: []",
      "---",
      "```",
      "",
      "#### Instructions for intake-job",
      "# Processing Intake Jobs",
    ].join("\n")}${any(String)}`,
  );
});

// ### Frontmatter jobs inline their refs and inject schema instructions
//
// The core purge fix: a real frontmatter intake job has its referenced item
// cards inlined and its intake-job schema instructions injected. (Pre-purge the
// XML-only `extractRefs`/`extractRootTag` regexes silently dropped both.)
void test("The core purge fix:", async (t) => {
  const box = await makeTmpBox({ git: true });
  await box.write("store/inbox/item1.card", "---\nstatus: new\n---\nHello from item one");

  const desc = (await describeJob(
    {
      card: { file: "x.intake.job.card", priority: "normal", createdAt: null },
      relPath: "_bookkeeping/jobs/x.intake.job.card",
      content: createIntakeJobTemplate({
        connector: "rss",
        description: "New items to triage",
        items: ["store/inbox/item1.card"],
      }),
    },
    box.root,
  )).full;

  t.check(
    desc,
    str`${[
      "### _bookkeeping/jobs/x.intake.job.card",
      "```",
      "---",
      "connector: rss",
      "priority: normal",
      "description: New items to triage",
      "items:",
      "  - ref: store/inbox/item1.card",
      "---",
      "```",
      "",
      "#### store/inbox/item1.card",
      "```",
      "---",
      "status: new",
      "---",
      "Hello from item one",
      "```",
      "",
      "#### Instructions for intake-job",
      "# Processing Intake Jobs",
    ].join("\n")}${any(String)}`,
  );

  await box.cleanup();
});

// ### Handles missing refs gracefully
void test("Handles missing refs gracefully", async (t) => {
  const desc = (await describeJob(
    {
      card: { file: "task.intake.job.card", priority: "normal", createdAt: null },
      relPath: "_bookkeeping/jobs/task.intake.job.card",
      content: createIntakeJobTemplate({
        connector: "rss",
        description: "Process this",
        items: ["store/items/missing.card"],
      }),
    },
    "/tmp/fake-box",
  )).full;
  t.check(
    desc,
    str`${[
      "### _bookkeeping/jobs/task.intake.job.card",
      "```",
      "---",
      "connector: rss",
      "priority: normal",
      "description: Process this",
      "items:",
      "  - ref: store/items/missing.card",
      "---",
      "```",
      "",
      "#### Instructions for intake-job",
      "# Processing Intake Jobs",
    ].join("\n")}${any(String)}`,
  );
});

// ### Unparseable jobs degrade visibly, not silently
//
// A job that isn't a recognized frontmatter card (legacy XML, hand-edited) is
// surfaced with its raw content and a warning rather than crashing the batch.
void test("A job that isn't a recognized frontmatter card (legacy XML, hand-edited) is s...", async (t) => {
  const desc = (await describeJob(
    {
      card: { file: "legacy.job.card", priority: "normal", createdAt: null },
      relPath: "_bookkeeping/jobs/legacy.job.card",
      content: "<job><description>Old XML job</description></job>",
    },
    "/tmp/fake-box",
  )).full;
  t.check(
    desc,
    `### _bookkeeping/jobs/legacy.job.card
_⚠️ Could not parse this job as a card (missing frontmatter block); showing raw content._
\`\`\`
<job><description>Old XML job</description></job>
\`\`\``,
  );
});
