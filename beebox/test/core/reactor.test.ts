// # Reactor Unit Tests
//
// Tests for the reactor's pure functions: prompt building, job discovery,
// procedure detection, and job description building.

import { test } from "tap";
import "agent-doctest/tap";
import {
  buildReactorSystemPrompt,
  buildReactorUserPrompt,
} from "../../src/core/reactor/prompts.js";
import { findJobCards } from "../../src/core/reactor/job-discovery.js";
import { buildJobDescription } from "../../src/core/reactor/engine/batch-jobs.js";
import { createIntakeJobTemplate } from "../../src/schemas/intake-job.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";

// ## buildReactorSystemPrompt
//
// ### No absolute filesystem paths
//
// The system prompt must never embed the box's absolute path — agent-visible
// text stays box-relative (`docs/implemented-plans/one-root-box-layout.md`, criterion 4).
void test("The system prompt must never embed the box's absolute path — agent-visible te...", async (t) => {
  // doctest:L27
  t.check(
    /\/(Users|home|tmp|private)\//.test(buildReactorSystemPrompt())
    ,
    false,
  );
});

// ## buildReactorUserPrompt
//
// ### Formats job list with descriptions
void test("Formats job list with descriptions", async (t) => {
  // doctest:L36
  const prompt = buildReactorUserPrompt(
    ["_bookkeeping/jobs/task1.job.card", "_bookkeeping/jobs/task2.job.card"],
    { jobDescriptions: ["### _bookkeeping/jobs/task1.job.card\n```\ndo thing 1\n```",
     "### _bookkeeping/jobs/task2.job.card\n```\ndo thing 2\n```"] },
  );
  await t.checkText(prompt.includes("2 job(s)"), "true");

  // doctest:L44
  await t.checkText(prompt.includes("do thing 1"), "true");

  // doctest:L47
  await t.checkText(prompt.includes("do thing 2"), "true");
});

// ### Ambient todo line, when given, leads the prompt
void test("Ambient todo line, when given, leads the prompt", async (t) => {
  // doctest:L54
  const promptWithAmbient = buildReactorUserPrompt(
    ["_bookkeeping/jobs/only.job.card"],
    {
      jobDescriptions: ["### _bookkeeping/jobs/only.job.card\n```\nsolo task\n```"],
      ambientLine: "3 open todos on the plate (1 escalated) — `bbx query todos`",
    },
  );
  await t.checkText(promptWithAmbient.startsWith("3 open todos on the plate (1 escalated)"), "true");
});

// ### No ambient line, when omitted or null
void test("No ambient line, when omitted or null", async (t) => {
  // doctest:L68
  const promptNoAmbient = buildReactorUserPrompt(
    ["_bookkeeping/jobs/only.job.card"],
    { jobDescriptions: ["### _bookkeeping/jobs/only.job.card\n```\nsolo task\n```"], ambientLine: null },
  );
  await t.checkText(promptNoAmbient.startsWith("Please process"), "true");
});

// ## findJobCards
//
// ### Finds job cards and sorts by priority
void test("Finds job cards and sorts by priority", async (t) => {
  // doctest:L81
  const box = await makeTmpBox({ git: true });
  const jobsDir = path.join(box.root, "_bookkeeping/jobs");
  await box.write("_bookkeeping/jobs/task-a.job.card", "---\npriority: low\n---\nLow A");
  await box.write("_bookkeeping/jobs/task-b.job.card", "---\npriority: normal\n---\nNormal B");
  await box.write("_bookkeeping/jobs/task-c.job.card", "---\npriority: low\n---\nLow C");

  // doctest:L87
  const cards = await findJobCards(jobsDir);
  await t.checkText(cards.length, "3");

  // doctest:L91
  t.check(
    // Normal priority comes first
    cards[0]?.priority,
    "normal",
  );

  // doctest:L95
  t.check(cards[1]?.priority, "low");

  // doctest:L98
  t.check(cards[2]?.priority, "low");

  // doctest:L101
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
  // doctest:L113
  const box = await makeTmpBox({ git: true });
  const jobsDir = path.join(box.root, "_bookkeeping/jobs");
  await box.write("_bookkeeping/jobs/2026-08-18T09-30-00-gmail.intake.job.card", "---\n---\nStamped to the second");
  await box.write("_bookkeeping/jobs/2026-08-18T09-30.contains-backfill.job.card", "---\n---\nStamped to the minute");
  await box.write("_bookkeeping/jobs/2026-99-99T99-99-bad.intake.job.card", "---\n---\nNot a date");
  await box.write("_bookkeeping/jobs/handwritten.job.card", "---\n---\nNo stamp at all");

  // doctest:L120
  const byFile = new Map((await findJobCards(jobsDir)).map((c) => [c.file, c.createdAt]));
  t.check(byFile.get("2026-08-18T09-30-00-gmail.intake.job.card")?.toISOString(), "2026-08-18T09:30:00.000Z");

  // doctest:L124
  t.check(byFile.get("2026-08-18T09-30.contains-backfill.job.card")?.toISOString(), "2026-08-18T09:30:00.000Z");

  // The two that carry no usable stamp fall back to the mtime, so they read as
  // newly written rather than as ancient or as unknown.

  // doctest:L132
  const fallbacks = ["2026-99-99T99-99-bad.intake.job.card", "handwritten.job.card"];
  await t.checkText(fallbacks.every((f) => Date.now() - (byFile.get(f)?.getTime() ?? 0) < 60_000), "true");

  // doctest:L136
  await box.cleanup();
});

// ### Type filter only matches typed suffix
void test("Type filter only matches typed suffix", async (t) => {
  // doctest:L142
  const box = await makeTmpBox({ git: true });
  const jobsDir = path.join(box.root, "_bookkeeping/jobs");
  await box.write("_bookkeeping/jobs/msg1.digest.job.card", "---\nconnector: rss\n---\nDigest");
  await box.write("_bookkeeping/jobs/sweep.intake.job.card", "---\nconnector: gmail\n---\nIntake");

  // doctest:L147
  const digestOnly = await findJobCards(jobsDir, { typeFilter: "digest" });
  await t.checkText(digestOnly.length, "1");

  // doctest:L151
  t.check(digestOnly[0]?.file, "msg1.digest.job.card");

  // doctest:L154
  const all = await findJobCards(jobsDir);
  await t.checkText(all.length, "2");

  // doctest:L158
  await box.cleanup();
});

// ### Connector filter drops jobs whose connector field does not match
//
// A job no connector made (here, a full wakeup's inbox triage) matches no
// connector filter:
void test("A job no connector made (here, a full wakeup's inbox triage) matches no conne...", async (t) => {
  // doctest:L167
  const box = await makeTmpBox({ git: true });
  const jobsDir = path.join(box.root, "_bookkeeping/jobs");
  await box.write("_bookkeeping/jobs/email.intake.job.card", "---\nconnector: gmail\n---\nEmail triage");
  await box.write("_bookkeeping/jobs/feed.digest.job.card", "---\nconnector: rss\n---\nDigest");
  await box.write("_bookkeeping/jobs/inbox.intake.job.card", "---\npriority: normal\n---\nInbox triage");

  // doctest:L173
  const gmailOnly = await findJobCards(jobsDir, { connectorFilter: "gmail" });
  t.check(gmailOnly.map((c) => c.file), [
    "email.intake.job.card",
  ]);

  // doctest:L177
  const rssOnly = await findJobCards(jobsDir, { connectorFilter: "rss" });
  t.check(rssOnly.map((c) => c.file), [
    "feed.digest.job.card",
  ]);

  // doctest:L181
  // Other jobs stay put for a future run that does match them
  const noFilter = await findJobCards(jobsDir);
  await t.checkText(noFilter.length, "3");

  // doctest:L186
  await box.cleanup();
});

// ### Frontmatter job cards: priority and connector come from YAML fields
//
// Current job cards are YAML frontmatter, not XML — discovery reads the
// `priority:` and `connector:` fields (this regressed once when discovery
// only grepped XML attributes, silently dropping every frontmatter job
// from filtered runs):
void test("Current job cards are YAML frontmatter, not XML — discovery reads the priorit...", async (t) => {
  // doctest:L197
  const box = await makeTmpBox({ git: true });
  const jobsDir = path.join(box.root, "_bookkeeping/jobs");
  await box.write("_bookkeeping/jobs/y1.intake.job.card", "---\nconnector: gmail\npriority: low\ndescription: Triage 1 inbox item\nitems:\n  - ref: _content/inbox/a.doc.card\n---\n");
  await box.write("_bookkeeping/jobs/y2.intake.job.card", "---\nconnector: rss\npriority: normal\ndescription: Triage 0 items\nitems: []\n---\n");

  // doctest:L202
  const gmailOnly = await findJobCards(jobsDir, { connectorFilter: "gmail" });
  t.check(gmailOnly.map((c) => c.file), [
    "y1.intake.job.card",
  ]);

  // doctest:L206
  t.check(gmailOnly[0]?.priority, "low");

  // doctest:L209
  await box.cleanup();
});

// ### Empty directory returns empty array
void test("Empty directory returns empty array", async (t) => {
  // doctest:L215
  const box = await makeTmpBox({ git: true });
  await fs.mkdir(path.join(box.root, "_bookkeeping/jobs"), { recursive: true });
  const cards = await findJobCards(path.join(box.root, "_bookkeeping/jobs"));
  await t.checkText(cards.length, "0");

  // doctest:L221
  await box.cleanup();
});

// ### Non-existent directory returns empty array
void test("Non-existent directory returns empty array", async (t) => {
  // doctest:L227
  const cards = await findJobCards("/tmp/nonexistent-reactor-test-dir");
  await t.checkText(cards.length, "0");
});

// ## buildJobDescription
//
// ### Includes the job card and priority label (no xml fence)
void test("Includes the job card and priority label (no xml fence)", async (t) => {
  // doctest:L237
  const desc = await buildJobDescription(
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
  );
  await t.checkText(desc.includes("*(low priority)*"), "true");

  // doctest:L253
  await t.checkText(desc.includes("Do something"), "true");

  // doctest:L256
  await t.checkText(
    // The card body is fenced plainly — the misleading ```xml label is gone
    desc.includes("```xml"),
    "false",
  );
});

// ### Frontmatter jobs inline their refs and inject schema instructions
//
// The core purge fix: a real frontmatter intake job has its referenced item
// cards inlined and its intake-job schema instructions injected. (Pre-purge the
// XML-only `extractRefs`/`extractRootTag` regexes silently dropped both.)
void test("The core purge fix:", async (t) => {
  // doctest:L268
  const box = await makeTmpBox({ git: true });
  await box.write("store/inbox/item1.card", "---\nstatus: new\n---\nHello from item one");

  // doctest:L271
  const desc = await buildJobDescription(
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
  );

  // doctest:L284
  await t.checkText(
    // Referenced item card is inlined
    desc.includes("Hello from item one"),
    "true",
  );

  // doctest:L288
  await t.checkText(desc.includes("#### store/inbox/item1.card"), "true");

  // doctest:L291
  await t.checkText(
    // Intake-job schema instructions are injected
    desc.includes("Processing Intake Jobs"),
    "true",
  );

  // doctest:L295
  await box.cleanup();
});

// ### Handles missing refs gracefully
void test("Handles missing refs gracefully", async (t) => {
  // doctest:L301
  const desc = await buildJobDescription(
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
  );
  await t.checkText(
    // Should not crash, just omit the missing ref
    desc.includes("Process this"),
    "true",
  );

  // doctest:L317
  await t.checkText(
    // The ref section header should not appear (file doesn't exist)
    desc.includes("#### store/items/missing.card"),
    "false",
  );
});

// ### Unparseable jobs degrade visibly, not silently
//
// A job that isn't a recognized frontmatter card (legacy XML, hand-edited) is
// surfaced with its raw content and a warning rather than crashing the batch.
void test("A job that isn't a recognized frontmatter card (legacy XML, hand-edited) is s...", async (t) => {
  // doctest:L328
  const desc = await buildJobDescription(
    {
      card: { file: "legacy.job.card", priority: "normal", createdAt: null },
      relPath: "_bookkeeping/jobs/legacy.job.card",
      content: "<job><description>Old XML job</description></job>",
    },
    "/tmp/fake-box",
  );
  await t.checkText(desc.includes("Could not parse this job as a card"), "true");

  // doctest:L339
  await t.checkText(
    // Raw content is still shown so the agent can act
    desc.includes("Old XML job"),
    "true",
  );
});
