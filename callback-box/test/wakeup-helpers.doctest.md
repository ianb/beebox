# Wakeup Helpers

The `cb wakeup` command orchestrates several phases. These tests cover the
individual helper functions that do the filesystem work.

```ts setup
import { join } from "node:path";
import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { makeTmpBox } from "./helpers/doctest-helpers.js";
import { initBox } from "../src/core/box.js";
import { createIntakeJobsForUnjobbed } from "../src/cli/commands/wakeup.js";
```

## createIntakeJobsForUnjobbed

### Creates intake jobs for unjobbed inbox items

When there are card files in `box/inbox/` that aren't referenced by any
existing job, an intake job gets created:

```ts
const box = await makeTmpBox({ git: true });
await initBox(box.root);
box.commitAll("init box");

// Put two cards in the inbox
await box.seed("box/inbox/note1.memo.card", "<memo>Hello</memo>");
await box.seed("box/inbox/note2.task.card", "<task>Do thing</task>");
box.commitAll("add inbox items");

const count = await createIntakeJobsForUnjobbed(box.root);
count
=> 2

// A job was created in box/jobs/
const allFiles = await readdir(join(box.root, "box/jobs"));
const jobFiles = allFiles.filter(f => f.endsWith(".intake.job.card"));
jobFiles.length
=> 1

// The job references both items
const content = await readFile(join(box.root, "box/jobs", jobFiles[0]), "utf-8");
content.includes("ref: box/inbox/note1.memo.card")
=> true

content.includes("ref: box/inbox/note2.task.card")
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
await box.seed("box/inbox/already-handled.memo.card", "<memo>Old</memo>");

// Create a job that already references it
await box.seed(
  "box/jobs/existing.intake.job.card",
  '<intake-job created="2026-01-01T00:00:00Z" source="test"><item ref="box/inbox/already-handled.memo.card" /></intake-job>',
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

await box.seed("box/inbox/note.memo.card", "<memo>Important</memo>");
await box.seed("box/inbox/snap.capture-session.card", "<capture-session>Snap</capture-session>");
await box.seed("box/inbox/pic.image.card", "<image>Photo</image>");
box.commitAll("add items");

const count = await createIntakeJobsForUnjobbed(box.root);
count
=> 3

const allFiles = await readdir(join(box.root, "box/jobs"));
const jobFiles = allFiles.filter(f => f.endsWith(".intake.job.card")).sort();
jobFiles.length
=> 2

// One normal-priority job with the memo, one low-priority with captures
const job0 = await readFile(join(box.root, "box/jobs", jobFiles[0]), "utf-8");
const job1 = await readFile(join(box.root, "box/jobs", jobFiles[1]), "utf-8");
const allContent = job0 + job1;
allContent.includes("note.memo.card")
=> true

allContent.includes("snap.capture-session.card")
=> true
```

### Skips excluded subdirectories (feedback)

Items in `box/inbox/feedback/` have their own pipeline and are not
picked up for intake:

```ts
const box = await makeTmpBox({ git: true });
await initBox(box.root);
box.commitAll("init box");

await box.seed("box/inbox/feedback/fb1.feedback.card", "<feedback>Good</feedback>");
// One real inbox item
await box.seed("box/inbox/real.memo.card", "<memo>Real item</memo>");
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

Under `cb wakeup --connector X`, only items in the connector's
declared `inboxPaths` are picked up, and the resulting intake job
is tagged `source="X"` so the same wakeup's reactor (with the
matching `sourceFilter`) processes it.

```ts
const box = await makeTmpBox({ git: true });
await initBox(box.root);
box.commitAll("init box");

// One item in the gmail-owned subdir, one in an unrelated subdir
await box.seed("box/inbox/email/thread-1/msg-001.email-message.card", "<email-message>Hi</email-message>");
await box.seed("box/inbox/pages-saved/page1.memo.card", "<memo>Saved</memo>");
box.commitAll("add items");

const fakeGmail = { name: "gmail", inboxPaths: ["box/inbox/email"] };
const count = await createIntakeJobsForUnjobbed(box.root, { connector: fakeGmail });

// Only the email item — the pages-saved item is left for full wakeup
count
=> 1

const allFiles = await readdir(join(box.root, "box/jobs"));
const jobFiles = allFiles.filter(f => f.endsWith(".intake.job.card"));
const content = await readFile(join(box.root, "box/jobs", jobFiles[0]), "utf-8");
content.includes("source: gmail")
=> true

content.includes("pages-saved")
=> false
```

