# contains backfill: wakeup queues one batch at a time

`createContainsBackfillJob` writes a generic `.job.card` asking a
background agent to fill `contains:` on cards missing it — one batch per
wakeup, no new job while a previous backfill job is still pending.

```ts setup
import { createContainsBackfillJob } from "../../../src/cli/commands/wakeup-steps.js";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";

const MEMO = (text: string) =>
  "---\ncreated: 2026-05-22T10:00:00Z\n---\n" + text + "\n";
```

## Missing-contains cards produce one pending job card

```ts
const box = await makeTmpBox({ git: true });
await box.write("store/notes/A.memo.card", MEMO("alpha notes"));
await box.write("store/notes/B.memo.card", MEMO("beta notes"));
box.commitAll("seed cards");
const queued = await createContainsBackfillJob(box.root);
queued
=> 2

const listing = await box.list("box/jobs");
listing.includes("contains-backfill.job.card")
=> true
```

The job card carries the writing rule and the item refs:

```ts continue
const jobs = (await box.list("box/jobs")).split("\n").filter((f) => f.includes("contains-backfill.job.card"));
const job = await box.read(jobs[0]!);
job.includes('source="contains-backfill"')
=> true

job.includes('<item ref="store/notes/A.memo.card"/>')
=> true

job.includes("cb contains update")
=> true
```

## A pending backfill job blocks queueing another

```ts continue
await createContainsBackfillJob(box.root)
=> 0
```

## Nothing missing → nothing queued

```ts
const box2 = await makeTmpBox({ git: true });
await box2.write(
  "store/notes/Done.memo.card",
  "---\ncreated: 2026-05-22T10:00:00Z\ncontains: Already annotated.\n---\nbody\n"
);
box2.commitAll("seed");
await createContainsBackfillJob(box2.root)
=> 0
```

```ts cleanup
await box2.cleanup();
```
