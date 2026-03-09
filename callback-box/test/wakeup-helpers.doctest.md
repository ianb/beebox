# Wakeup Helpers

The `cb wakeup` command orchestrates several phases. These tests cover the
individual helper functions that do the filesystem work.

```ts setup
import { join } from "node:path";
import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { makeTmpBox } from "./helpers/doctest-helpers.js";
import { initBox } from "../src/core/box.js";
import {
  createIntakeJobsForUnjobbed,
  createGuideRevisionJobIfNeeded,
} from "../src/cli/commands/wakeup.js";
```

## createIntakeJobsForUnjobbed

### Creates intake jobs for unjobbed inbox items

When there are card files in `box/inbox/` that aren't referenced by any
existing job, an intake job gets created:

```
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
content.includes('ref="box/inbox/note1.memo.card"')
=> true

content.includes('ref="box/inbox/note2.task.card"')
=> true
```

### Skips items already referenced by a job

If a pending job already references an inbox item, it's not double-counted:

```
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

```
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

### Skips excluded subdirectories (news, feedback, editions)

Items in `box/inbox/news/`, `box/inbox/feedback/`, and `box/inbox/editions/`
have their own pipelines and are not picked up for intake:

```
const box = await makeTmpBox({ git: true });
await initBox(box.root);
box.commitAll("init box");

await box.seed("box/inbox/news/headline.news-item.card", "<news-item>News</news-item>");
await box.seed("box/inbox/feedback/fb1.feedback.card", "<feedback>Good</feedback>");
await box.seed("box/inbox/editions/ed1.edition.card", "<edition>V1</edition>");
// One real inbox item
await box.seed("box/inbox/real.memo.card", "<memo>Real item</memo>");
box.commitAll("add items");

const count = await createIntakeJobsForUnjobbed(box.root);
count
=> 1
```

### Returns 0 for empty inbox

```
const box = await makeTmpBox({ git: true });
await initBox(box.root);
box.commitAll("init box");

const count = await createIntakeJobsForUnjobbed(box.root);
count
=> 0
```

## createGuideRevisionJobIfNeeded

### Creates a guide-revision job when briefs have feedback

When archived briefs have `overall-rating=` (meaning the user read and rated
them) and no `guide-revision=` attribute (meaning they haven't been processed),
a guide-revision job is created:

```
const box = await makeTmpBox({ git: true });
await initBox(box.root);
box.commitAll("init box");

// Set a fixed time for deterministic filenames
process.env.CB_TIME = "2026-02-15T10:00:00Z";

// Create an archived brief with feedback
await mkdir(join(box.root, "store/archive/briefs"), { recursive: true });
await box.seed(
  "store/archive/briefs/2026-02-14_tech.news-brief.card",
  '<news-brief overall-rating="great" read-at="2026-02-14T20:00:00Z">Good stuff</news-brief>',
);
box.commitAll("add brief");

const jobPath = await createGuideRevisionJobIfNeeded(box.root);
typeof jobPath
=> string

// Job references the brief
const content = await readFile(join(box.root, jobPath), "utf-8");
content.includes("guide-revision-job")
=> true

content.includes('ref="store/archive/briefs/2026-02-14_tech.news-brief.card"')
=> true

content.includes('source="feedback-sync"')
=> true

delete process.env.CB_TIME;
```

### Returns null when no briefs have feedback

Briefs without `overall-rating=` haven't been read yet and shouldn't
trigger a guide revision:

```
const box = await makeTmpBox({ git: true });
await initBox(box.root);
box.commitAll("init box");

await mkdir(join(box.root, "store/archive/briefs"), { recursive: true });
await box.seed(
  "store/archive/briefs/2026-02-14_tech.news-brief.card",
  "<news-brief>Unread brief</news-brief>",
);
box.commitAll("add brief");

const jobPath = await createGuideRevisionJobIfNeeded(box.root);
jobPath
=> null
```

### Skips already-processed briefs

Briefs that already have `guide-revision=` are already processed:

```
const box = await makeTmpBox({ git: true });
await initBox(box.root);
box.commitAll("init box");

await mkdir(join(box.root, "store/archive/briefs"), { recursive: true });
await box.seed(
  "store/archive/briefs/2026-02-14_tech.news-brief.card",
  '<news-brief overall-rating="great" guide-revision="2026-02-15T00:00:00Z">Already processed</news-brief>',
);
box.commitAll("add brief");

const jobPath = await createGuideRevisionJobIfNeeded(box.root);
jobPath
=> null
```

### Skips if a guide-revision job already exists

Only one guide-revision job at a time:

```
const box = await makeTmpBox({ git: true });
await initBox(box.root);
box.commitAll("init box");

process.env.CB_TIME = "2026-02-15T10:00:00Z";

// Brief with feedback
await mkdir(join(box.root, "store/archive/briefs"), { recursive: true });
await box.seed(
  "store/archive/briefs/2026-02-14_tech.news-brief.card",
  '<news-brief overall-rating="ok">Decent</news-brief>',
);
// Existing guide-revision job
await box.seed(
  "box/jobs/2026-02-13_feedback.guide-revision.job.card",
  '<guide-revision-job created="2026-02-13T00:00:00Z" source="feedback-sync"><description>Already queued</description></guide-revision-job>',
);
box.commitAll("setup");

const jobPath = await createGuideRevisionJobIfNeeded(box.root);
jobPath
=> null

delete process.env.CB_TIME;
```

### Includes guide path when news guide exists

```
const box = await makeTmpBox({ git: true });
await initBox(box.root);
box.commitAll("init box");

process.env.CB_TIME = "2026-02-15T10:00:00Z";

// Brief with feedback
await mkdir(join(box.root, "store/archive/briefs"), { recursive: true });
await box.seed(
  "store/archive/briefs/2026-02-14_tech.news-brief.card",
  '<news-brief overall-rating="great">Nice</news-brief>',
);
// News guide exists
await box.seed("config/news.guide.card", "<news-guide>Be interesting</news-guide>");
box.commitAll("setup");

const jobPath = await createGuideRevisionJobIfNeeded(box.root);
const content = await readFile(join(box.root, jobPath), "utf-8");
content.includes('guide="config/news.guide.card"')
=> true

delete process.env.CB_TIME;
```
