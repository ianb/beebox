// # Wakeup Helpers
//
// The `bbx wakeup` command orchestrates several phases. These tests cover the
// individual helper functions that do the filesystem work.

import { test } from "tap";
import "agent-doctest/tap";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { readFile, readdir } from "node:fs/promises";
import { makeTmpBox } from "../../../helpers/doctest-helpers.js";
import { initBox } from "../../../../src/core/box/structure/core.js";
import { createIntakeJobsForUnjobbed, cleanupStaleJobs } from "../../../../src/cli/commands/wakeup/command.js";
import type { Connector } from "../../../../src/connector.js";

// ## createIntakeJobsForUnjobbed
//
// ### Creates intake jobs for unjobbed inbox items
//
// When there are card files in `_content/inbox/` that aren't referenced by any
// existing job, an intake job gets created:
void test("When there are card files in content/inbox/ that aren't referenced by any exi...", async (t) => {
  // doctest:L24
  const box = await makeTmpBox({ git: true });
  await initBox(box.root);
  box.commitAll("init box");

  // doctest:L28
  // Put two cards in the inbox
  await box.seed("_content/inbox/note1.doc.card", "---\ntitle: Hello\n---\n");
  await box.seed("_content/inbox/note2.task.card", "<task>Do thing</task>");
  box.commitAll("add inbox items");

  // doctest:L33
  const count = await createIntakeJobsForUnjobbed(box.root);
  t.check(count, 2);

  // doctest:L37
  // A job was created in _bookkeeping/jobs/
  const allFiles = await readdir(join(box.root, "_bookkeeping/jobs"));
  const jobFiles = allFiles.filter(f => f.endsWith(".intake.job.card"));
  await t.checkText(jobFiles.length, "1");

  // doctest:L43
  // The job references both items
  const content = await readFile(join(box.root, "_bookkeeping/jobs", jobFiles[0] ?? ""), "utf-8");
  await t.checkText(content.includes("ref: _content/inbox/note1.doc.card"), "true");

  // doctest:L48
  await t.checkText(content.includes("ref: _content/inbox/note2.task.card"), "true");

  // Running the scan again is a no-op: the YAML `- ref:` lines in the job
  // created above are collected, so the same items aren't re-jobbed (this
  // regressed once when ref collection only understood legacy XML `ref=""`):

  // doctest:L57
  t.check(await createIntakeJobsForUnjobbed(box.root), 0);
});

// ### Skips items already referenced by a job
//
// If a pending job already references an inbox item, it's not double-counted:
void test("If a pending job already references an inbox item, it's not double-counted:", async (t) => {
  // doctest:L66
  const box = await makeTmpBox({ git: true });
  await initBox(box.root);
  box.commitAll("init box");

  // doctest:L70
  // Create an inbox item
  await box.seed("_content/inbox/already-handled.doc.card", "---\ntitle: Old\n---\n");

  // doctest:L73
  // Create a job that already references it
  await box.seed(
    "_bookkeeping/jobs/existing.intake.job.card",
    "---\nstatus: pending\ncreated: 2026-01-01T00:00:00Z\ndescription: Existing\nitems:\n  - ref: _content/inbox/already-handled.doc.card\n---\n",
  );
  box.commitAll("setup");

  // doctest:L80
  const count = await createIntakeJobsForUnjobbed(box.root);
  t.check(count, 0);
});

// ### Separates low-priority items (captures, images, audio)
//
// Capture sessions, images, and audio cards get their own low-priority job:
void test("Capture sessions, images, and audio cards get their own low-priority job:", async (t) => {
  // doctest:L90
  const box = await makeTmpBox({ git: true });
  await initBox(box.root);
  box.commitAll("init box");

  // doctest:L94
  await box.seed("_content/inbox/note.doc.card", "---\ntitle: Important\n---\n");
  await box.seed("_content/inbox/snap.capture-session.card", "<capture-session>Snap</capture-session>");
  await box.seed("_content/inbox/pic.image.card", "<image>Photo</image>");
  box.commitAll("add items");

  // doctest:L99
  const count = await createIntakeJobsForUnjobbed(box.root);
  t.check(count, 3);

  // doctest:L103
  const allFiles = await readdir(join(box.root, "_bookkeeping/jobs"));
  const jobFiles = allFiles.filter(f => f.endsWith(".intake.job.card")).toSorted();
  await t.checkText(jobFiles.length, "2");

  // doctest:L108
  // One normal-priority job with the doc, one low-priority with captures
  const job0 = await readFile(join(box.root, "_bookkeeping/jobs", jobFiles[0] ?? ""), "utf-8");
  const job1 = await readFile(join(box.root, "_bookkeeping/jobs", jobFiles[1] ?? ""), "utf-8");
  const allContent = job0 + job1;
  await t.checkText(allContent.includes("note.doc.card"), "true");

  // doctest:L115
  await t.checkText(allContent.includes("snap.capture-session.card"), "true");
});

// ### Skips excluded subdirectories (feedback)
//
// Items in `_content/inbox/feedback/` have their own pipeline and are not
// picked up for intake:
void test("Items in content/inbox/feedback/ have their own pipeline and are not picked u...", async (t) => {
  // doctest:L125
  const box = await makeTmpBox({ git: true });
  await initBox(box.root);
  box.commitAll("init box");

  // doctest:L129
  await box.seed("_content/inbox/feedback/fb1.feedback.card", "<feedback>Good</feedback>");
  // One real inbox item
  await box.seed("_content/inbox/real.doc.card", "---\ntitle: Real item\n---\n");
  box.commitAll("add items");

  // doctest:L134
  const count = await createIntakeJobsForUnjobbed(box.root);
  t.check(count, 1);
});

// ### Skips outbound drafts waiting in the email inbox
//
// An `email-outbound` card is a draft the agent wrote, waiting for the Gmail
// connector to upload it. It is never intake work, so a draft that cannot upload
// yet does not earn a fresh intake job every cycle:
void test("An email-outbound card is a draft the agent wrote, waiting for the Gmail conn...", async (t) => {
  // doctest:L146
  const box = await makeTmpBox({ git: true });
  await initBox(box.root);
  box.commitAll("init box");

  // doctest:L150
  await box.seed("_content/inbox/email/thread-1/draft-001.email-outbound.card", "---\ntype: email-outbound\nstatus: draft\nto: a@example.com\nsubject: Hi\n---\nHello.\n");
  await box.seed("_content/inbox/email/thread-1/msg-001.email-message.card", "<email-message>Hi</email-message>");
  box.commitAll("add items");

  // doctest:L154
  // Only the received message is jobbed
  const count = await createIntakeJobsForUnjobbed(box.root);
  t.check(count, 1);

  // doctest:L159
  const allFiles = await readdir(join(box.root, "_bookkeeping/jobs"));
  const content = await readFile(join(box.root, "_bookkeeping/jobs", allFiles.find(f => f.endsWith(".intake.job.card")) ?? ""), "utf-8");
  await t.checkText(content.includes("email-outbound"), "false");
});

// ### Returns 0 for empty inbox
void test("Returns 0 for empty inbox", async (t) => {
  // doctest:L168
  const box = await makeTmpBox({ git: true });
  await initBox(box.root);
  box.commitAll("init box");

  // doctest:L172
  const count = await createIntakeJobsForUnjobbed(box.root);
  t.check(count, 0);
});

// ### Connector-scoped scan only sees that connector's inbox subdir and tags jobs with its name
//
// Under `bbx wakeup --connector X`, only items in the connector's
// declared `inboxPaths` are picked up, and the resulting intake job
// is tagged `connector: X` so the same wakeup's reactor (with the
// matching `connectorFilter`) processes it.
void test("Under bbx wakeup --connector X, only items in the connector's declared inboxP...", async (t) => {
  // doctest:L185
  const box = await makeTmpBox({ git: true });
  await initBox(box.root);
  box.commitAll("init box");

  // doctest:L189
  // One item in the gmail-owned subdir, one in an unrelated subdir
  await box.seed("_content/inbox/email/thread-1/msg-001.email-message.card", "<email-message>Hi</email-message>");
  await box.seed("_content/inbox/pages-saved/page1.doc.card", "---\ntitle: Saved\n---\n");
  box.commitAll("add items");

  // doctest:L194
  const fakeGmail: Connector = { name: "gmail", inboxPaths: ["_content/inbox/email"], sync: async () => ({ success: true, created: [], updated: [] }) };
  const count = await createIntakeJobsForUnjobbed(box.root, { connector: fakeGmail });

  // doctest:L197
  t.check(
    // Only the email item — the pages-saved item is left for full wakeup
    count,
    1,
  );

  // doctest:L201
  const allFiles = await readdir(join(box.root, "_bookkeeping/jobs"));
  const jobFile = allFiles.find(f => f.endsWith(".intake.job.card"));
  const content = await readFile(join(box.root, "_bookkeeping/jobs", jobFile ?? ""), "utf-8");
  await t.checkText(content.includes("connector: gmail"), "true");

  // doctest:L207
  await t.checkText(content.includes("pages-saved"), "false");
});

// ### A scoped scan takes items from jobs its reactor would skip
//
// A full wakeup's intake job has no `connector`, and the scoped reactor processes
// only jobs whose `connector` matches. So a scoped scan treats an item held only
// by such a job as unjobbed: the item joins the scoped job and leaves the other
// one. A full scan leaves the item where it is.
void test("A full wakeup's intake job has no connector, and the scoped reactor processes...", async (t) => {
  // doctest:L219
  const box = await makeTmpBox({ git: true });
  await initBox(box.root);
  box.commitAll("init box");

  // doctest:L223
  await box.seed("_content/inbox/email/x.email-thread.card", "<email-thread>Hi</email-thread>");
  await box.seed("_content/inbox/email/y.email-thread.card", "<email-thread>Yo</email-thread>");
  await box.seed("_content/inbox/note.doc.card", "---\ntitle: Kept\n---\n");
  box.commitAll("add items");

  // doctest:L228
  await createIntakeJobsForUnjobbed(box.root);
  const jobsDir = join(box.root, "_bookkeeping/jobs");
  const intakeJobs = async () => (await readdir(jobsDir)).filter((f) => f.endsWith(".intake.job.card")).toSorted();
  const [unscoped] = await intakeJobs();
  t.check(unscoped?.endsWith("-inbox.intake.job.card"), true);

  // The gmail-scoped scan takes both email items. The unscoped job keeps the doc,
  // and its description counts what remains:

  // doctest:L240
  const fakeGmail: Connector = { name: "gmail", inboxPaths: ["_content/inbox/email"], sync: async () => ({ success: true, created: [], updated: [] }) };
  t.check(await createIntakeJobsForUnjobbed(box.root, { connector: fakeGmail }), 2);

  // doctest:L244
  const gmailJob = (await intakeJobs()).find((f) => f.endsWith("-gmail.intake.job.card"));
  const gmailContent = await readFile(join(jobsDir, gmailJob ?? ""), "utf-8");
  t.check(
    [
      gmailContent.includes("connector: gmail"),
      gmailContent.includes("ref: _content/inbox/email/x.email-thread.card"),
      gmailContent.includes("ref: _content/inbox/email/y.email-thread.card"),
    ].join(" "),
    "true true true",
  );

  // doctest:L253
  const unscopedContent = await readFile(join(jobsDir, unscoped ?? ""), "utf-8");
  t.check(
    [
      unscopedContent.includes("email-thread"),
      unscopedContent.includes("ref: _content/inbox/note.doc.card"),
      unscopedContent.includes("description: Triage 1 inbox item\n"),
    ].join(" "),
    "false true true",
  );

  // The move is committed with the new job:

  // doctest:L265
  await t.checkText(execSync("git status --porcelain", { cwd: box.root }).toString().trim() === "", "true");
});

// A job that the move empties is deleted. Here the unscoped job holds only an
// email item:
void test("A job that the move empties is deleted.", async (t) => {
  // doctest:L273
  const box = await makeTmpBox({ git: true });
  await initBox(box.root);
  box.commitAll("init box");
  await box.seed("_content/inbox/email/x.email-thread.card", "<email-thread>Hi</email-thread>");
  await box.seed(
    "_bookkeeping/jobs/full.intake.job.card",
    "---\nstatus: pending\ncreated: 2026-01-01T00:00:00Z\ndescription: Triage 1 inbox item\nitems:\n  - ref: _content/inbox/email/x.email-thread.card\n---\n",
  );
  box.commitAll("setup");

  // doctest:L283
  const fakeGmail: Connector = { name: "gmail", inboxPaths: ["_content/inbox/email"], sync: async () => ({ success: true, created: [], updated: [] }) };
  t.check(await createIntakeJobsForUnjobbed(box.root, { connector: fakeGmail }), 1);

  // doctest:L287
  const jobs = (await readdir(join(box.root, "_bookkeeping/jobs"))).filter((f) => f.endsWith(".intake.job.card"));
  t.check([jobs.includes("full.intake.job.card"), jobs.some((f) => f.endsWith("-gmail.intake.job.card"))].join(" "), "false true");

  // doctest:L291
  await t.checkText(execSync("git status --porcelain", { cwd: box.root }).toString().trim() === "", "true");

  // A scoped scan does not take an item from a job it will process — a second gmail
  // scan is a no-op:

  // doctest:L299
  t.check(await createIntakeJobsForUnjobbed(box.root, { connector: fakeGmail }), 0);
});

// ## cleanupStaleJobs
//
// Stale-job cleanup reads the job's frontmatter `status:` and refs. (It used to
// match the XML attribute `status="pending"`, so it silently skipped every
// frontmatter job — the format all live jobs use.)
//
// ### Deletes a pending job whose refs all point at missing files
void test("Stale-job cleanup reads the job's frontmatter status: and refs.", async (t) => {
  // doctest:L312
  const box = await makeTmpBox({ git: true });
  await box.write(
    "_bookkeeping/jobs/dead.intake.job.card",
    "---\nstatus: pending\ncreated: 2026-07-01T00:00:00Z\nconnector: gmail\ndescription: Triage\nitems:\n  - ref: _content/inbox/gone.doc.card\n---\n",
  );
  box.commitAll("queue stale job");

  // doctest:L319
  const cleaned = await cleanupStaleJobs(box.root);
  t.check(cleaned, 1);

  // doctest:L323
  await t.checkText((await readdir(join(box.root, "_bookkeeping/jobs"))).includes("dead.intake.job.card"), "false");
});

// ### Keeps a pending job that still has a live ref
void test("Keeps a pending job that still has a live ref", async (t) => {
  // doctest:L330
  const box = await makeTmpBox({ git: true });
  await box.write("_content/inbox/live.doc.card", "---\ntitle: Note\n---\nstill here");
  await box.write(
    "_bookkeeping/jobs/live.intake.job.card",
    "---\nstatus: pending\ncreated: 2026-07-01T00:00:00Z\nconnector: gmail\ndescription: Triage\nitems:\n  - ref: _content/inbox/live.doc.card\n---\n",
  );
  box.commitAll("queue live job");

  // doctest:L338
  t.check(await cleanupStaleJobs(box.root), 0);
});

// ### Treats an omitted status as the schema default (pending)
//
// A job that leaves `status:` off relies on the schema default (`pending`), so it
// is still eligible for stale cleanup — `readCardFrontmatter` is a loose read that
// doesn't apply defaults, so cleanup must.
void test("A job that leaves status: off relies on the schema default (pending), so it i...", async (t) => {
  // doctest:L349
  const box = await makeTmpBox({ git: true });
  await box.write(
    "_bookkeeping/jobs/nostatus.intake.job.card",
    "---\ncreated: 2026-07-01T00:00:00Z\nconnector: gmail\ndescription: Triage\nitems:\n  - ref: _content/inbox/gone.doc.card\n---\n",
  );
  box.commitAll("queue statusless job");

  // doctest:L356
  t.check(await cleanupStaleJobs(box.root), 1);
});
