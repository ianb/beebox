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
  ["### box/jobs/task1.job.card\n```xml\n<job>do thing 1</job>\n```",
   "### box/jobs/task2.job.card\n```xml\n<job>do thing 2</job>\n```"],
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
  ["### box/jobs/only.job.card\n```xml\n<job>solo task</job>\n```"],
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
await box.write("box/jobs/task-a.job.card", `<job priority="low"><description>Low A</description></job>`);
await box.write("box/jobs/task-b.job.card", `<job><description>Normal B</description></job>`);
await box.write("box/jobs/task-c.job.card", `<job priority="low"><description>Low C</description></job>`);

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
await box.write("box/jobs/msg1.chat.job.card", `<chat-job source="telegram"><description>Chat</description></chat-job>`);
await box.write("box/jobs/sweep.intake.job.card", `<intake-job source="gmail"><description>Intake</description></intake-job>`);

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

### Source filter drops jobs whose root source attr does not match

```ts
const box = await makeTmpBox({ git: true });
const jobsDir = path.join(box.root, "box/jobs");
await box.write("box/jobs/email.intake.job.card", `<intake-job source="gmail"><description>Email triage</description></intake-job>`);
await box.write("box/jobs/chat.chat.job.card", `<chat-job source="telegram"><description>Chat</description></chat-job>`);
await box.write("box/jobs/rss.intake.job.card", `<intake-job source="rss"><description>RSS triage</description></intake-job>`);

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

### Includes XML content and priority label

```ts
const desc = await buildJobDescription(
  {
    card: { file: "task.job.card", priority: "low" },
    relPath: "box/jobs/task.job.card",
    content: `<job priority="low"><description>Do something</description></job>`,  },
  "/tmp/fake-box",
);
desc.includes("*(low priority)*")
=> true

desc.includes("Do something")
=> true

desc.includes("```xml")
=> true
```

### Inlines referenced files

```ts
const box = await makeTmpBox({ git: true });
await box.write("store/threads/t1.card", `<thread><message>Hello world</message></thread>`);

const desc = await buildJobDescription(
  {
    card: { file: "reply.chat.job.card", priority: "normal" },
    relPath: "box/jobs/reply.chat.job.card",
    content: `<chat-job><thread ref="store/threads/t1.card" /><description>Reply</description></chat-job>`,  },
  box.root,
);
desc.includes("Hello world")
=> true

desc.includes("#### store/threads/t1.card")
=> true

await box.cleanup();
```

### Handles missing refs gracefully

```ts
const desc = await buildJobDescription(
  {
    card: { file: "task.job.card", priority: "normal" },
    relPath: "box/jobs/task.job.card",
    content: `<job><item ref="store/items/missing.card" /><description>Process</description></job>`,  },
  "/tmp/fake-box",
);
// Should not crash, just omit the missing ref
desc.includes("Process")
=> true

// The ref section header should not appear (file doesn't exist)
desc.includes("#### store/items/missing.card")
=> false
```
