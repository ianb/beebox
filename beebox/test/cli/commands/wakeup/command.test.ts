// # Wakeup Helpers
//
// The `bbx wakeup` command orchestrates several phases. These tests cover the
// individual helper functions that do the filesystem work.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { readFile, readdir } from "node:fs/promises";
import { makeTmpBox } from "../../../helpers/test-helpers.js";
import { initBox } from "../../../../src/core/box/structure/core.js";
import { createIntakeJobsForUnjobbed, cleanupStaleJobs, parseMaxCycles, wakeupReactorOptions } from "../../../../src/cli/commands/wakeup/command.js";
import type { Connector } from "../../../../src/connector.js";

// A fixed box clock makes the job filenames (stamped in box time) stable.
process.env.BBX_TIME = "2026-03-04T05:06:07Z";

// ## createIntakeJobsForUnjobbed
//
// ### Creates intake jobs for unjobbed inbox items
//
// When there are card files in `_content/inbox/` that aren't referenced by any
// existing job, an intake job gets created:
void test("When there are card files in content/inbox/ that aren't referenced by any exi...", async (t) => {
  const box = await makeTmpBox({ git: true });
  await initBox(box.root);
  box.commitAll("init box");

  // Put two cards in the inbox
  await box.seed("_content/inbox/note1.doc.card", "---\ntitle: Hello\n---\n");
  await box.seed("_content/inbox/note2.task.card", "<task>Do thing</task>");
  box.commitAll("add inbox items");

  const count = await createIntakeJobsForUnjobbed(box.root);
  t.check(count, 2);

  // A job was created in _bookkeeping/jobs/
  const allFiles = await readdir(join(box.root, "_bookkeeping/jobs"));
  const jobFile = allFiles.find(f => f.endsWith(".intake.job.card"));
  t.check(allFiles, [".gitkeep", "2026-03-04T05-06-07-inbox.intake.job.card"]);

  // The job references both items
  const content = await readFile(join(box.root, "_bookkeeping/jobs", jobFile ?? ""), "utf-8");
  t.check(content, `---
priority: normal
description: Triage 2 inbox items
items:
  - ref: _content/inbox/note1.doc.card
  - ref: _content/inbox/note2.task.card
---
`);

  // Running the scan again is a no-op: the YAML `- ref:` lines in the job
  // created above are collected, so the same items aren't re-jobbed (this
  // regressed once when ref collection only understood legacy XML `ref=""`):

  t.check(await createIntakeJobsForUnjobbed(box.root), 0);
});

// ### Skips items already referenced by a job
//
// If a pending job already references an inbox item, it's not double-counted:
void test("If a pending job already references an inbox item, it's not double-counted:", async (t) => {
  const box = await makeTmpBox({ git: true });
  await initBox(box.root);
  box.commitAll("init box");

  // Create an inbox item
  await box.seed("_content/inbox/already-handled.doc.card", "---\ntitle: Old\n---\n");

  // Create a job that already references it
  await box.seed(
    "_bookkeeping/jobs/existing.intake.job.card",
    "---\nstatus: pending\ncreated: 2026-01-01T00:00:00Z\ndescription: Existing\nitems:\n  - ref: _content/inbox/already-handled.doc.card\n---\n",
  );
  box.commitAll("setup");

  const count = await createIntakeJobsForUnjobbed(box.root);
  t.check(count, 0);
});

// ### Separates low-priority items (captures, images, audio)
//
// Capture sessions, images, and audio cards get their own low-priority job:
void test("Capture sessions, images, and audio cards get their own low-priority job:", async (t) => {
  const box = await makeTmpBox({ git: true });
  await initBox(box.root);
  box.commitAll("init box");

  await box.seed("_content/inbox/note.doc.card", "---\ntitle: Important\n---\n");
  await box.seed("_content/inbox/snap.capture-session.card", "<capture-session>Snap</capture-session>");
  await box.seed("_content/inbox/pic.image.card", "<image>Photo</image>");
  box.commitAll("add items");

  const count = await createIntakeJobsForUnjobbed(box.root);
  t.check(count, 3);

  const allFiles = await readdir(join(box.root, "_bookkeeping/jobs"));
  const jobFiles = allFiles.filter(f => f.endsWith(".intake.job.card")).toSorted();
  t.check(allFiles, [".gitkeep", "2026-03-04T05-06-07-inbox-low.intake.job.card", "2026-03-04T05-06-07-inbox.intake.job.card"]);

  // One normal-priority job with the doc, one low-priority with captures
  const job0 = await readFile(join(box.root, "_bookkeeping/jobs", jobFiles[0] ?? ""), "utf-8");
  const job1 = await readFile(join(box.root, "_bookkeeping/jobs", jobFiles[1] ?? ""), "utf-8");
  t.check(job0, `---
priority: low
description: Triage 2 capture items
items:
  - ref: _content/inbox/pic.image.card
  - ref: _content/inbox/snap.capture-session.card
---
`);
  t.check(job1, `---
priority: normal
description: Triage 1 inbox item
items:
  - ref: _content/inbox/note.doc.card
---
`);
});

// ### Skips excluded subdirectories (feedback)
//
// Items in `_content/inbox/feedback/` have their own pipeline and are not
// picked up for intake:
void test("Items in content/inbox/feedback/ have their own pipeline and are not picked u...", async (t) => {
  const box = await makeTmpBox({ git: true });
  await initBox(box.root);
  box.commitAll("init box");

  await box.seed("_content/inbox/feedback/fb1.feedback.card", "<feedback>Good</feedback>");
  // One real inbox item
  await box.seed("_content/inbox/real.doc.card", "---\ntitle: Real item\n---\n");
  box.commitAll("add items");

  const count = await createIntakeJobsForUnjobbed(box.root);
  t.check(count, 1);
});

// ### Skips outbound drafts waiting in the email inbox
//
// An `email-outbound` card is a draft the agent wrote, waiting for the Gmail
// connector to upload it. It is never intake work, so a draft that cannot upload
// yet does not earn a fresh intake job every cycle:
void test("An email-outbound card is a draft the agent wrote, waiting for the Gmail conn...", async (t) => {
  const box = await makeTmpBox({ git: true });
  await initBox(box.root);
  box.commitAll("init box");

  await box.seed("_content/inbox/email/thread-1/draft-001.email-outbound.card", "---\ntype: email-outbound\nstatus: draft\nto: a@example.com\nsubject: Hi\n---\nHello.\n");
  await box.seed("_content/inbox/email/thread-1/msg-001.email-message.card", "<email-message>Hi</email-message>");
  box.commitAll("add items");

  // Only the received message is jobbed
  const count = await createIntakeJobsForUnjobbed(box.root);
  t.check(count, 1);

  const allFiles = await readdir(join(box.root, "_bookkeeping/jobs"));
  const content = await readFile(join(box.root, "_bookkeeping/jobs", allFiles.find(f => f.endsWith(".intake.job.card")) ?? ""), "utf-8");
  t.check(content, `---
priority: normal
description: Triage 1 inbox item
items:
  - ref: _content/inbox/email/thread-1/msg-001.email-message.card
---
`);
});

// ### Returns 0 for empty inbox
void test("Returns 0 for empty inbox", async (t) => {
  const box = await makeTmpBox({ git: true });
  await initBox(box.root);
  box.commitAll("init box");

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
  const box = await makeTmpBox({ git: true });
  await initBox(box.root);
  box.commitAll("init box");

  // One item in the gmail-owned subdir, one in an unrelated subdir
  await box.seed("_content/inbox/email/thread-1/msg-001.email-message.card", "<email-message>Hi</email-message>");
  await box.seed("_content/inbox/pages-saved/page1.doc.card", "---\ntitle: Saved\n---\n");
  box.commitAll("add items");

  const fakeGmail: Connector = { name: "gmail", inboxPaths: ["_content/inbox/email"], sync: async () => ({ success: true, created: [], updated: [] }) };
  const count = await createIntakeJobsForUnjobbed(box.root, { connector: fakeGmail });

  t.check(
    // Only the email item — the pages-saved item is left for full wakeup
    count,
    1,
  );

  const allFiles = await readdir(join(box.root, "_bookkeeping/jobs"));
  const jobFile = allFiles.find(f => f.endsWith(".intake.job.card"));
  const content = await readFile(join(box.root, "_bookkeeping/jobs", jobFile ?? ""), "utf-8");
  t.check(content, `---
connector: gmail
priority: normal
description: Triage 1 inbox item
items:
  - ref: _content/inbox/email/thread-1/msg-001.email-message.card
---
`);
});

// ### A scoped scan takes items from jobs its reactor would skip
//
// A full wakeup's intake job has no `connector`, and the scoped reactor processes
// only jobs whose `connector` matches. So a scoped scan treats an item held only
// by such a job as unjobbed: the item joins the scoped job and leaves the other
// one. A full scan leaves the item where it is.
void test("A full wakeup's intake job has no connector, and the scoped reactor processes...", async (t) => {
  const box = await makeTmpBox({ git: true });
  await initBox(box.root);
  box.commitAll("init box");

  await box.seed("_content/inbox/email/x.email-thread.card", "<email-thread>Hi</email-thread>");
  await box.seed("_content/inbox/email/y.email-thread.card", "<email-thread>Yo</email-thread>");
  await box.seed("_content/inbox/note.doc.card", "---\ntitle: Kept\n---\n");
  box.commitAll("add items");

  await createIntakeJobsForUnjobbed(box.root);
  const jobsDir = join(box.root, "_bookkeeping/jobs");
  const intakeJobs = async () => (await readdir(jobsDir)).filter((f) => f.endsWith(".intake.job.card")).toSorted();
  const [unscoped] = await intakeJobs();
  t.check(unscoped, "2026-03-04T05-06-07-inbox.intake.job.card");

  // The gmail-scoped scan takes both email items. The unscoped job keeps the doc,
  // and its description counts what remains:

  const fakeGmail: Connector = { name: "gmail", inboxPaths: ["_content/inbox/email"], sync: async () => ({ success: true, created: [], updated: [] }) };
  t.check(await createIntakeJobsForUnjobbed(box.root, { connector: fakeGmail }), 2);

  const gmailJob = (await intakeJobs()).find((f) => f.endsWith("-gmail.intake.job.card"));
  const gmailContent = await readFile(join(jobsDir, gmailJob ?? ""), "utf-8");
  t.check(gmailContent, `---
connector: gmail
priority: normal
description: Triage 2 inbox items
items:
  - ref: _content/inbox/email/x.email-thread.card
  - ref: _content/inbox/email/y.email-thread.card
---
`);

  const unscopedContent = await readFile(join(jobsDir, unscoped ?? ""), "utf-8");
  t.check(unscopedContent, `---
priority: normal
description: Triage 1 inbox item
items:
  - ref: _content/inbox/note.doc.card
---
`);

  // The move is committed with the new job:

  t.checkText(execSync("git status --porcelain", { cwd: box.root }).toString().trim(), "");
});

// A job that the move empties is deleted. Here the unscoped job holds only an
// email item:
void test("A job that the move empties is deleted.", async (t) => {
  const box = await makeTmpBox({ git: true });
  await initBox(box.root);
  box.commitAll("init box");
  await box.seed("_content/inbox/email/x.email-thread.card", "<email-thread>Hi</email-thread>");
  await box.seed(
    "_bookkeeping/jobs/full.intake.job.card",
    "---\nstatus: pending\ncreated: 2026-01-01T00:00:00Z\ndescription: Triage 1 inbox item\nitems:\n  - ref: _content/inbox/email/x.email-thread.card\n---\n",
  );
  box.commitAll("setup");

  const fakeGmail: Connector = { name: "gmail", inboxPaths: ["_content/inbox/email"], sync: async () => ({ success: true, created: [], updated: [] }) };
  t.check(await createIntakeJobsForUnjobbed(box.root, { connector: fakeGmail }), 1);

  const jobs = (await readdir(join(box.root, "_bookkeeping/jobs"))).filter((f) => f.endsWith(".intake.job.card"));
  t.check(jobs, ["2026-03-04T05-06-07-gmail.intake.job.card"]);

  t.checkText(execSync("git status --porcelain", { cwd: box.root }).toString().trim(), "");

  // A scoped scan does not take an item from a job it will process — a second gmail
  // scan is a no-op:

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
  const box = await makeTmpBox({ git: true });
  await box.write(
    "_bookkeeping/jobs/dead.intake.job.card",
    "---\nstatus: pending\ncreated: 2026-07-01T00:00:00Z\nconnector: gmail\ndescription: Triage\nitems:\n  - ref: _content/inbox/gone.doc.card\n---\n",
  );
  box.commitAll("queue stale job");

  const cleaned = await cleanupStaleJobs(box.root);
  t.check(cleaned, 1);

  t.check(await readdir(join(box.root, "_bookkeeping/jobs")), [".gitkeep"]);
});

// ### Keeps a pending job that still has a live ref
void test("Keeps a pending job that still has a live ref", async (t) => {
  const box = await makeTmpBox({ git: true });
  await box.write("_content/inbox/live.doc.card", "---\ntitle: Note\n---\nstill here");
  await box.write(
    "_bookkeeping/jobs/live.intake.job.card",
    "---\nstatus: pending\ncreated: 2026-07-01T00:00:00Z\nconnector: gmail\ndescription: Triage\nitems:\n  - ref: _content/inbox/live.doc.card\n---\n",
  );
  box.commitAll("queue live job");

  t.check(await cleanupStaleJobs(box.root), 0);
});

// ### Treats an omitted status as the schema default (pending)
//
// A job that leaves `status:` off relies on the schema default (`pending`), so it
// is still eligible for stale cleanup — `readCardFrontmatter` is a loose read that
// doesn't apply defaults, so cleanup must.
void test("A job that leaves status: off relies on the schema default (pending), so it i...", async (t) => {
  const box = await makeTmpBox({ git: true });
  await box.write(
    "_bookkeeping/jobs/nostatus.intake.job.card",
    "---\ncreated: 2026-07-01T00:00:00Z\nconnector: gmail\ndescription: Triage\nitems:\n  - ref: _content/inbox/gone.doc.card\n---\n",
  );
  box.commitAll("queue statusless job");

  t.check(await cleanupStaleJobs(box.root), 1);
});

// ## `--max-cycles` reaches the reactor
//
// A wakeup runs one reactor cycle unless `--max-cycles <n>` asks for more; the
// job check's run asks for 3 (docs/implemented-plans/on-demand-job-triggers.md, Track C).
// The value must be a positive integer.
void test("--max-cycles reaches the reactor", async (t) => {
  t.check(
    {
      default: wakeupReactorOptions("/box", { connector: undefined, maxCycles: undefined }),
      three: wakeupReactorOptions("/box", { connector: undefined, maxCycles: parseMaxCycles("3") }),
      scoped: wakeupReactorOptions("/box", { connector: "gmail", maxCycles: undefined }),
      rejected: ["0", "1.5", "x"].map((value) => {
        try {
          return parseMaxCycles(value);
        } catch (e) {
          return e instanceof Error ? e.message : "not an Error";
        }
      }),
    },
    {
      default: { boxRoot: "/box", maxCycles: 1, skipLowPriority: true },
      three: { boxRoot: "/box", maxCycles: 3, skipLowPriority: true },
      scoped: { boxRoot: "/box", maxCycles: 1, skipLowPriority: true, connectorFilter: "gmail" },
      rejected: ["--max-cycles takes a positive integer", "--max-cycles takes a positive integer", "--max-cycles takes a positive integer"],
    },
  );
});
