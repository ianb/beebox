# Reactor Unit Tests

Tests for the reactor's pure functions: prompt building, job discovery,
procedure detection, and job description building.

```ts setup
import {
  buildReactorSystemPrompt,
  buildReactorUserPrompt,
} from "../../src/core/reactor/index.js";
import { findJobCards } from "../../src/core/reactor/job-discovery.js";
import { buildJobDescription } from "../../src/core/reactor/batch-jobs.js";
import { createIntakeJobTemplate } from "../../src/schemas/intake-job.js";
import { createChatJobTemplate } from "../../src/schemas/chat-job.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";
```

## buildReactorSystemPrompt

### Includes working directory and key instructions

```ts
const prompt = buildReactorSystemPrompt("/test/box");
prompt.includes("WORKING DIRECTORY: /test/box")
=> true

prompt.includes("processing jobs in a Callback Box")
=> true

prompt.includes("cb finish")
=> true

prompt.includes("do not need to re-read")
=> true
```

## buildReactorUserPrompt

### Formats job list with descriptions

```ts
const prompt = buildReactorUserPrompt(
  ["box/jobs/task1.job.card", "box/jobs/task2.job.card"],
  ["### box/jobs/task1.job.card\n```\ndo thing 1\n```",
   "### box/jobs/task2.job.card\n```\ndo thing 2\n```"],
);
prompt.includes("2 job(s)")
=> true

prompt.includes("do thing 1")
=> true

prompt.includes("do thing 2")
=> true

prompt.includes("cb finish")
=> true
```

### Single job

```ts
const prompt = buildReactorUserPrompt(
  ["box/jobs/only.job.card"],
  ["### box/jobs/only.job.card\n```\nsolo task\n```"],
);
prompt.includes("1 job(s)")
=> true

prompt.includes("solo task")
=> true
```

## findJobCards

### Finds job cards and sorts by priority

```ts
const box = await makeTmpBox({ git: true });
const jobsDir = path.join(box.root, "box/jobs");
await box.write("box/jobs/task-a.job.card", `---\npriority: low\n---\nLow A`);
await box.write("box/jobs/task-b.job.card", `---\npriority: normal\n---\nNormal B`);
await box.write("box/jobs/task-c.job.card", `---\npriority: low\n---\nLow C`);

const cards = await findJobCards(jobsDir);
cards.length
=> 3

// Normal priority comes first
cards[0].priority
=> normal

cards[1].priority
=> low

cards[2].priority
=> low

await box.cleanup();
```

### Type filter only matches typed suffix

```ts
const box = await makeTmpBox({ git: true });
const jobsDir = path.join(box.root, "box/jobs");
await box.write("box/jobs/msg1.chat.job.card", `---\nsource: telegram\n---\nChat`);
await box.write("box/jobs/sweep.intake.job.card", `---\nsource: gmail\n---\nIntake`);

const chatOnly = await findJobCards(jobsDir, { typeFilter: "chat" });
chatOnly.length
=> 1

chatOnly[0].file
=> msg1.chat.job.card

const all = await findJobCards(jobsDir);
all.length
=> 2

await box.cleanup();
```

### Source filter drops jobs whose source field does not match

```ts
const box = await makeTmpBox({ git: true });
const jobsDir = path.join(box.root, "box/jobs");
await box.write("box/jobs/email.intake.job.card", `---\nsource: gmail\n---\nEmail triage`);
await box.write("box/jobs/chat.chat.job.card", `---\nsource: telegram\n---\nChat`);
await box.write("box/jobs/rss.intake.job.card", `---\nsource: rss\n---\nRSS triage`);

const gmailOnly = await findJobCards(jobsDir, { sourceFilter: "gmail" });
JSON.stringify(gmailOnly.map((c) => c.file))
=> ["email.intake.job.card"]

const telegramOnly = await findJobCards(jobsDir, { sourceFilter: "telegram" });
JSON.stringify(telegramOnly.map((c) => c.file))
=> ["chat.chat.job.card"]

// Cross-cutting jobs (different source) stay put for a future run that does match them
const noFilter = await findJobCards(jobsDir);
noFilter.length
=> 3

await box.cleanup();
```

### Frontmatter job cards: priority and source come from YAML fields

Current job cards are YAML frontmatter, not XML — discovery reads the
`priority:` and `source:` fields (this regressed once when discovery
only grepped XML attributes, silently dropping every frontmatter job
from source-filtered runs):

```ts
const box = await makeTmpBox({ git: true });
const jobsDir = path.join(box.root, "box/jobs");
await box.write("box/jobs/y1.intake.job.card", "---\nstatus: pending\ncreated: 2026-06-09T00:00:00Z\nsource: gmail\npriority: low\ndescription: Triage 1 inbox item\nitems:\n  - ref: box/inbox/a.memo.card\n---\n");
await box.write("box/jobs/y2.intake.job.card", "---\nstatus: pending\ncreated: 2026-06-09T00:00:00Z\nsource: telegram\npriority: normal\ndescription: Triage 0 items\nitems: []\n---\n");

const gmailOnly = await findJobCards(jobsDir, { sourceFilter: "gmail" });
JSON.stringify(gmailOnly.map((c) => c.file))
=> ["y1.intake.job.card"]

gmailOnly[0].priority
=> low

await box.cleanup();
```

### Empty directory returns empty array

```ts
const box = await makeTmpBox({ git: true });
await fs.mkdir(path.join(box.root, "box/jobs"), { recursive: true });
const cards = await findJobCards(path.join(box.root, "box/jobs"));
cards.length
=> 0

await box.cleanup();
```

### Non-existent directory returns empty array

```ts
const cards = await findJobCards("/tmp/nonexistent-reactor-test-dir");
cards.length
=> 0
```

## buildJobDescription

### Includes the job card and priority label (no xml fence)

```ts
const desc = await buildJobDescription(
  {
    card: { file: "task.intake.job.card", priority: "low" },
    relPath: "box/jobs/task.intake.job.card",
    content: createIntakeJobTemplate({
      created: "2026-07-01T00:00:00Z",
      source: "rss",
      description: "Do something",
      items: [],
      priority: "low",
    }),
  },
  "/tmp/fake-box",
);
desc.includes("*(low priority)*")
=> true

desc.includes("Do something")
=> true

// The card body is fenced plainly — the misleading ```xml label is gone
desc.includes("```xml")
=> false
```

### Frontmatter jobs inline their refs and inject schema instructions

The core purge fix: a real frontmatter intake job has its referenced item
cards inlined and its intake-job schema instructions injected. (Pre-purge the
XML-only `extractRefs`/`extractRootTag` regexes silently dropped both.)

```ts
const box = await makeTmpBox({ git: true });
await box.write("store/inbox/item1.card", `---\nstatus: new\n---\nHello from item one`);

const desc = await buildJobDescription(
  {
    card: { file: "x.intake.job.card", priority: "normal" },
    relPath: "box/jobs/x.intake.job.card",
    content: createIntakeJobTemplate({
      created: "2026-07-01T00:00:00Z",
      source: "rss",
      description: "New items to triage",
      items: ["store/inbox/item1.card"],
    }),
  },
  box.root,
);

// Referenced item card is inlined
desc.includes("Hello from item one")
=> true

desc.includes("#### store/inbox/item1.card")
=> true

// Intake-job schema instructions are injected
desc.includes("Processing Intake Jobs")
=> true

await box.cleanup();
```

### Inlines a chat job's thread ref

The generic `{ref}` walk handles chat jobs' `thread: {ref}` too, not just
intake `items:`.

```ts
const box = await makeTmpBox({ git: true });
await box.write("store/threads/t1.chat-thread.card", `---\nstatus: new\ncreated: 2026-07-01T00:00:00Z\nsource: telegram\n---\nHello world`);

const desc = await buildJobDescription(
  {
    card: { file: "reply.chat.job.card", priority: "normal" },
    relPath: "box/jobs/reply.chat.job.card",
    content: createChatJobTemplate({
      created: "2026-07-01T00:00:00Z",
      source: "telegram",
      description: "Reply",
      threadRef: "store/threads/t1.chat-thread.card",
    }),
  },
  box.root,
);
desc.includes("Hello world")
=> true

desc.includes("#### store/threads/t1.chat-thread.card")
=> true

// Chat-job schema instructions are injected
desc.includes("Processing Chat Jobs")
=> true

await box.cleanup();
```

### Handles missing refs gracefully

```ts
const desc = await buildJobDescription(
  {
    card: { file: "task.intake.job.card", priority: "normal" },
    relPath: "box/jobs/task.intake.job.card",
    content: createIntakeJobTemplate({
      created: "2026-07-01T00:00:00Z",
      source: "rss",
      description: "Process this",
      items: ["store/items/missing.card"],
    }),
  },
  "/tmp/fake-box",
);
// Should not crash, just omit the missing ref
desc.includes("Process this")
=> true

// The ref section header should not appear (file doesn't exist)
desc.includes("#### store/items/missing.card")
=> false
```

### Unparseable jobs degrade visibly, not silently

A job that isn't a recognized frontmatter card (legacy XML, hand-edited) is
surfaced with its raw content and a warning rather than crashing the batch.

```ts
const desc = await buildJobDescription(
  {
    card: { file: "legacy.job.card", priority: "normal" },
    relPath: "box/jobs/legacy.job.card",
    content: `<job><description>Old XML job</description></job>`,
  },
  "/tmp/fake-box",
);
desc.includes("Could not parse this job as a card")
=> true

// Raw content is still shown so the agent can act
desc.includes("Old XML job")
=> true
```
