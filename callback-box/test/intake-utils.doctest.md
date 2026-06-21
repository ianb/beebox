# Intake Job Creation

`createOrAppendIntakeJob` manages intake job files in a box. It creates new job cards or appends items to existing ones from the same source.

```ts setup
import { makeTmpBox } from "./helpers/doctest-helpers.js";
import { createOrAppendIntakeJob } from "../src/connectors/intake-utils.js";
```

## Creating a new job

When no matching job exists, a new `.intake.job.card` file is created under `box/jobs/`:

```ts
const box = await makeTmpBox();
const path = await createOrAppendIntakeJob({
  boxRoot: box.root,
  source: "test-connector",
  items: ["box/inbox/item1.memo.card"],
  description: "Triage 1 item",
});
path.startsWith("box/jobs/") && path.endsWith(".intake.job.card")
=> true
```

```ts continue
await box.read(path)
=>
---
status: pending
created: «*»
source: test-connector
priority: normal
description: Triage 1 item
items:
  - ref: box/inbox/item1.memo.card
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
  items: ["box/inbox/item1.memo.card"],
  description: "Triage 1 item",
});
const path2 = await createOrAppendIntakeJob({
  boxRoot: box.root,
  source: "test-connector",
  items: ["box/inbox/item2.memo.card"],
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
created: «*»
source: test-connector
priority: normal
description: Triage 2 items
items:
  - ref: box/inbox/item1.memo.card
  - ref: box/inbox/item2.memo.card
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
  items: ["box/inbox/a.memo.card"],
  description: "From A",
});
const pathB = await createOrAppendIntakeJob({
  boxRoot: box.root,
  source: "connector-b",
  items: ["box/inbox/b.memo.card"],
  description: "From B",
});
pathA !== pathB
=> true
```

```ts continue
(await box.list("box/jobs")).split("\n").filter(f => f.endsWith(".intake.job.card")).length
=> 2
```

```ts cleanup
await box.cleanup();
```
