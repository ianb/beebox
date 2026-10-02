# Intake Job Creation

`createOrAppendIntakeJob` manages intake job files in a box. It creates new job cards or appends items to the pending one with the same batching key, `(connector, priority)`.

```ts setup
import { makeTmpBox } from "../helpers/doctest-helpers.js";
import { createOrAppendIntakeJob } from "../../src/job-cards/intake-utils.js";
```

## Creating a new job

When no matching job exists, a new `.intake.job.card` file is created under `_bookkeeping/jobs/`:

```ts
const box = await makeTmpBox();
const path = await createOrAppendIntakeJob({
  boxRoot: box.root,
  connector: "test-connector",
  items: ["_content/inbox/item1.memo.card"],
  description: "Triage 1 item",
});
path.startsWith("_bookkeeping/jobs/") && path.endsWith("-test-connector.intake.job.card")
=> true
```

```ts continue
await box.read(path)
=>
---
connector: test-connector
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

A second call with the same connector and priority appends to the existing job file rather than creating a new one:

```ts
const box = await makeTmpBox();
const path1 = await createOrAppendIntakeJob({
  boxRoot: box.root,
  connector: "test-connector",
  items: ["_content/inbox/item1.memo.card"],
  description: "Triage 1 item",
});
const path2 = await createOrAppendIntakeJob({
  boxRoot: box.root,
  connector: "test-connector",
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
connector: test-connector
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

## Different connectors or priorities get separate jobs

Calls with a different connector, no connector, or a different priority create
separate job files. The filename stem is the connector's name, or `inbox`
without one, with `-low` for low priority; the card itself carries no field
for the no-connector case:

```ts
const box = await makeTmpBox();
const created = [
  await createOrAppendIntakeJob({ boxRoot: box.root, connector: "connector-a", items: ["_content/inbox/a.memo.card"], description: "From A" }),
  await createOrAppendIntakeJob({ boxRoot: box.root, connector: "connector-b", items: ["_content/inbox/b.memo.card"], description: "From B" }),
  await createOrAppendIntakeJob({ boxRoot: box.root, items: ["_content/inbox/c.memo.card"], description: "Inbox" }),
  await createOrAppendIntakeJob({ boxRoot: box.root, items: ["_content/inbox/d.image.card"], priority: "low", description: "Captures" }),
];
JSON.stringify(created.map((p) => p.replace(/^.*T\d\d-\d\d-\d\d-/, "")))
=> ["connector-a.intake.job.card","connector-b.intake.job.card","inbox.intake.job.card","inbox-low.intake.job.card"]
```

```ts continue
await box.read(created[3])
=>
---
priority: low
description: Captures
items:
  - ref: _content/inbox/d.image.card
---
```

```ts cleanup
await box.cleanup();
```
## Concurrent appends to one job keep every item

The find/read/append/write span is a read-modify-write of one card that two
*processes* genuinely race: the scan promote worker appends to the unscoped
job from inside `bbx serve` while a full wakeup appends its own inbox items.
An unlocked append re-renders the whole card, so the loser's items would
simply vanish. Serializing per batching key (cross-process file lock, plus the
in-process card lock a PID-blind file lock cannot substitute for) is what
keeps all eight here.

```ts
const box = await makeTmpBox();
const paths = await Promise.all(
  Array.from({ length: 8 }, (_, i) =>
    createOrAppendIntakeJob({
      boxRoot: box.root,
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

## Different batching keys don't wait on each other

The lock is per batching key, so a `gmail`-scoped sync and a scan import
(no connector) proceed in parallel and neither lands in the other's job card.

```ts
const box = await makeTmpBox();
const [scanJob, gmailJob] = await Promise.all([
  createOrAppendIntakeJob({ boxRoot: box.root, items: ["_content/inbox/a.memo.card"], description: "Scan" }),
  createOrAppendIntakeJob({ boxRoot: box.root, connector: "gmail", items: ["_content/inbox/b.memo.card"], description: "Mail" }),
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
