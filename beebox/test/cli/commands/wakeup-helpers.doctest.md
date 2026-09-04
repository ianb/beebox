# Wakeup Helpers

The `bbx wakeup` command orchestrates several phases. These tests cover the
individual helper functions that do the filesystem work.

```ts setup
import { join } from "node:path";
import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";
import { initBox } from "../../../src/core/box/index.js";
import { createIntakeJobsForUnjobbed, cleanupStaleJobs } from "../../../src/cli/commands/wakeup.js";
```

## createIntakeJobsForUnjobbed

### Creates intake jobs for unjobbed inbox items

When there are card files in `_content/inbox/` that aren't referenced by any
existing job, an intake job gets created:

```ts
const box = await makeTmpBox({ git: true });
await initBox(box.root);
box.commitAll("init box");

// Put two cards in the inbox
await box.seed("_content/inbox/note1.memo.card", "<memo>Hello</memo>");
await box.seed("_content/inbox/note2.task.card", "<task>Do thing</task>");
box.commitAll("add inbox items");

const count = await createIntakeJobsForUnjobbed(box.root);
count
=> 2

// A job was created in _bookkeeping/jobs/
const allFiles = await readdir(join(box.root, "_bookkeeping/jobs"));
const jobFiles = allFiles.filter(f => f.endsWith(".intake.job.card"));
jobFiles.length
=> 1

// The job references both items
const content = await readFile(join(box.root, "_bookkeeping/jobs", jobFiles[0]), "utf-8");
content.includes("ref: _content/inbox/note1.memo.card")
=> true

content.includes("ref: _content/inbox/note2.task.card")
=> true
```

Running the scan again is a no-op: the YAML `- ref:` lines in the job
created above are collected, so the same items aren't re-jobbed (this
regressed once when ref collection only understood legacy XML `ref=""`):

```ts continue
await createIntakeJobsForUnjobbed(box.root)
=> 0
```

### Skips items already referenced by a job

If a pending job already references an inbox item, it's not double-counted:

```ts
const box = await makeTmpBox({ git: true });
await initBox(box.root);
box.commitAll("init box");

// Create an inbox item
await box.seed("_content/inbox/already-handled.memo.card", "<memo>Old</memo>");

// Create a job that already references it
await box.seed(
  "_bookkeeping/jobs/existing.intake.job.card",
  "---\nstatus: pending\ncreated: 2026-01-01T00:00:00Z\nsource: test\ndescription: Existing\nitems:\n  - ref: _content/inbox/already-handled.memo.card\n---\n",
);
box.commitAll("setup");

const count = await createIntakeJobsForUnjobbed(box.root);
count
=> 0
```

### Separates low-priority items (captures, images, audio)

Capture sessions, images, and audio cards get their own low-priority job:

```ts
const box = await makeTmpBox({ git: true });
await initBox(box.root);
box.commitAll("init box");

await box.seed("_content/inbox/note.memo.card", "<memo>Important</memo>");
await box.seed("_content/inbox/snap.capture-session.card", "<capture-session>Snap</capture-session>");
await box.seed("_content/inbox/pic.image.card", "<image>Photo</image>");
box.commitAll("add items");

const count = await createIntakeJobsForUnjobbed(box.root);
count
=> 3

const allFiles = await readdir(join(box.root, "_bookkeeping/jobs"));
const jobFiles = allFiles.filter(f => f.endsWith(".intake.job.card")).sort();
jobFiles.length
=> 2

// One normal-priority job with the memo, one low-priority with captures
const job0 = await readFile(join(box.root, "_bookkeeping/jobs", jobFiles[0]), "utf-8");
const job1 = await readFile(join(box.root, "_bookkeeping/jobs", jobFiles[1]), "utf-8");
const allContent = job0 + job1;
allContent.includes("note.memo.card")
=> true

allContent.includes("snap.capture-session.card")
=> true
```

### Skips excluded subdirectories (feedback)

Items in `_content/inbox/feedback/` have their own pipeline and are not
picked up for intake:

```ts
const box = await makeTmpBox({ git: true });
await initBox(box.root);
box.commitAll("init box");

await box.seed("_content/inbox/feedback/fb1.feedback.card", "<feedback>Good</feedback>");
// One real inbox item
await box.seed("_content/inbox/real.memo.card", "<memo>Real item</memo>");
box.commitAll("add items");

const count = await createIntakeJobsForUnjobbed(box.root);
count
=> 1
```

### Returns 0 for empty inbox

```ts
const box = await makeTmpBox({ git: true });
await initBox(box.root);
box.commitAll("init box");

const count = await createIntakeJobsForUnjobbed(box.root);
count
=> 0
```

### Connector-scoped scan only sees that connector's inbox subdir and tags jobs with its name

Under `bbx wakeup --connector X`, only items in the connector's
declared `inboxPaths` are picked up, and the resulting intake job
is tagged `source="X"` so the same wakeup's reactor (with the
matching `sourceFilter`) processes it.

```ts
const box = await makeTmpBox({ git: true });
await initBox(box.root);
box.commitAll("init box");

// One item in the gmail-owned subdir, one in an unrelated subdir
await box.seed("_content/inbox/email/thread-1/msg-001.email-message.card", "<email-message>Hi</email-message>");
await box.seed("_content/inbox/pages-saved/page1.memo.card", "<memo>Saved</memo>");
box.commitAll("add items");

const fakeGmail = { name: "gmail", inboxPaths: ["_content/inbox/email"] };
const count = await createIntakeJobsForUnjobbed(box.root, { connector: fakeGmail });

// Only the email item — the pages-saved item is left for full wakeup
count
=> 1

const allFiles = await readdir(join(box.root, "_bookkeeping/jobs"));
const jobFiles = allFiles.filter(f => f.endsWith(".intake.job.card"));
const content = await readFile(join(box.root, "_bookkeeping/jobs", jobFiles[0]), "utf-8");
content.includes("source: gmail")
=> true

content.includes("pages-saved")
=> false
```

## cleanupStaleJobs

Stale-job cleanup reads the job's frontmatter `status:` and refs. (It used to
match the XML attribute `status="pending"`, so it silently skipped every
frontmatter job — the format all live jobs use.)

### Deletes a pending job whose refs all point at missing files

```ts
const box = await makeTmpBox({ git: true });
await box.write(
  "_bookkeeping/jobs/dead.intake.job.card",
  "---\nstatus: pending\ncreated: 2026-07-01T00:00:00Z\nsource: gmail\ndescription: Triage\nitems:\n  - ref: _content/inbox/gone.memo.card\n---\n",
);
box.commitAll("queue stale job");

const cleaned = await cleanupStaleJobs(box.root);
cleaned
=> 1

(await readdir(join(box.root, "_bookkeeping/jobs"))).includes("dead.intake.job.card")
=> false
```

### Keeps a pending job that still has a live ref

```ts
const box = await makeTmpBox({ git: true });
await box.write("_content/inbox/live.memo.card", "---\nstatus: new\n---\nstill here");
await box.write(
  "_bookkeeping/jobs/live.intake.job.card",
  "---\nstatus: pending\ncreated: 2026-07-01T00:00:00Z\nsource: gmail\ndescription: Triage\nitems:\n  - ref: _content/inbox/live.memo.card\n---\n",
);
box.commitAll("queue live job");

await cleanupStaleJobs(box.root)
=> 0
```

### Treats an omitted status as the schema default (pending)

A job that leaves `status:` off relies on the schema default (`pending`), so it
is still eligible for stale cleanup — `readCardFrontmatter` is a loose read that
doesn't apply defaults, so cleanup must.

```ts
const box = await makeTmpBox({ git: true });
await box.write(
  "_bookkeeping/jobs/nostatus.intake.job.card",
  "---\ncreated: 2026-07-01T00:00:00Z\nsource: gmail\ndescription: Triage\nitems:\n  - ref: _content/inbox/gone.memo.card\n---\n",
);
box.commitAll("queue statusless job");

await cleanupStaleJobs(box.root)
=> 1
```

