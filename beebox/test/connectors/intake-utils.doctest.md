# Intake Job Creation

`createOrAppendIntakeJob` manages intake job files in a box. It creates new job cards or appends items to existing ones from the same source.

```ts setup
import { makeTmpBox } from "../helpers/doctest-helpers.js";
import { createOrAppendIntakeJob } from "../../src/connectors/intake-utils.js";
```

## Creating a new job

When no matching job exists, a new `.intake.job.card` file is created under `_bookkeeping/jobs/`:

```ts
const box = await makeTmpBox();
const path = await createOrAppendIntakeJob({
  boxRoot: box.root,
  source: "test-connector",
  items: ["_content/inbox/item1.memo.card"],
  description: "Triage 1 item",
});
path.startsWith("_bookkeeping/jobs/") && path.endsWith(".intake.job.card")
=> true
```

```ts continue
await box.read(path)
=>
---
status: pending
source: test-connector
priority: normal
description: Triage 1 item
items:
  - ref: _content/inbox/item1.memo.card
---
```

```ts cleanup
await box.cleanup();
```

## Appending to an existing job

A second call with the same `source` appends to the existing job file rather than creating a new one:

```ts
const box = await makeTmpBox();
const path1 = await createOrAppendIntakeJob({
  boxRoot: box.root,
  source: "test-connector",
  items: ["_content/inbox/item1.memo.card"],
  description: "Triage 1 item",
});
const path2 = await createOrAppendIntakeJob({
  boxRoot: box.root,
  source: "test-connector",
  items: ["_content/inbox/item2.memo.card"],
  description: "Triage 2 items",
});
path1 === path2
=> true
```

The updated file contains both items with the new description:

```ts continue
await box.read(path2)
=>
---
status: pending
source: test-connector
priority: normal
description: Triage 2 items
items:
  - ref: _content/inbox/item1.memo.card
  - ref: _content/inbox/item2.memo.card
---
```

```ts cleanup
await box.cleanup();
```

## Different sources get separate jobs

Calls with different `source` values create separate job files:

```ts
const box = await makeTmpBox();
const pathA = await createOrAppendIntakeJob({
  boxRoot: box.root,
  source: "connector-a",
  items: ["_content/inbox/a.memo.card"],
  description: "From A",
});
const pathB = await createOrAppendIntakeJob({
  boxRoot: box.root,
  source: "connector-b",
  items: ["_content/inbox/b.memo.card"],
  description: "From B",
});
pathA !== pathB
=> true
```

```ts continue
(await box.list("_bookkeeping/jobs")).split("\n").filter(f => f.endsWith(".intake.job.card")).length
=> 2
```

```ts cleanup
await box.cleanup();
```
## Concurrent appends to one source keep every item

The find/read/append/write span is a read-modify-write of one card that two
*processes* genuinely race: the scan promote worker appends a `scan` job from
inside `bbx serve` while a wakeup's connector sync appends its own. An unlocked
append re-renders the whole card, so the loser's items would simply vanish.
Serializing per source (cross-process file lock, plus the in-process card lock a
PID-blind file lock cannot substitute for) is what keeps all eight here.

```ts
const box = await makeTmpBox();
const paths = await Promise.all(
  Array.from({ length: 8 }, (_, i) =>
    createOrAppendIntakeJob({
      boxRoot: box.root,
      source: "scan",
      items: [`_content/inbox/scan-${String(i)}.capture-session.card`],
      description: "Concurrent scan batch",
    })
  )
);
const card = await box.read(paths[0]);
JSON.stringify({
  jobs: new Set(paths).size,
  items: card.split("\n").filter((line) => line.startsWith("  - ref:")).length,
})
=> {"jobs":1,"items":8}
```

```ts cleanup
await box.cleanup();
```

## Different sources don't wait on each other

The lock is per source, so a `gmail` sync and a `scan` import proceed in
parallel and neither lands in the other's job card.

```ts
const box = await makeTmpBox();
const [scanJob, gmailJob] = await Promise.all([
  createOrAppendIntakeJob({ boxRoot: box.root, source: "scan", items: ["_content/inbox/a.memo.card"], description: "Scan" }),
  createOrAppendIntakeJob({ boxRoot: box.root, source: "gmail", items: ["_content/inbox/b.memo.card"], description: "Mail" }),
]);
JSON.stringify({
  distinct: scanJob !== gmailJob,
  scan: (await box.read(scanJob)).includes("ref: _content/inbox/a.memo.card"),
  gmail: (await box.read(gmailJob)).includes("ref: _content/inbox/b.memo.card"),
})
=> {"distinct":true,"scan":true,"gmail":true}
```

```ts cleanup
await box.cleanup();
```
