# contains backfill: wakeup queues one batch at a time

`createContainsBackfillJob` writes a `contains-backfill.job.card` (YAML
frontmatter) asking a background agent to fill `contains:` on cards missing
it — one batch per wakeup, no new job while a previous backfill job is still
pending. The how-to prose lives in the schema's `instructions` (injected into
the reactor prompt by type), so the card itself just carries the refs and a
description.

It reads the `contains` state that `refreshSearchIndex` writes, and `bbx wakeup`
runs the two as separate consecutive steps. They used to be one function, with
the refresh sitting *below* the "a backfill job is already pending" early
return — so one undrainable job card removed the box's only scheduled index
refresh indefinitely. The last section here pins them apart.

```ts setup
import { createContainsBackfillJob, refreshSearchIndex } from "../../../src/cli/commands/wakeup-steps.js";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";
import { searchBox } from "../../../src/core/search/query.js";
import { acquireLock, releaseLock } from "../../../src/lib/file-lock.js";
import { searchLockPath } from "../../../src/core/search/search-store.js";

const MEMO = (text: string) =>
  "---\ncreated: 2026-05-22T10:00:00Z\n---\n" + text + "\n";
```

## Missing-contains cards produce one pending job card

```ts
const box = await makeTmpBox({ git: true });
await box.write("store/notes/A.memo.card", MEMO("alpha notes"));
await box.write("store/notes/B.memo.card", MEMO("beta notes"));
box.commitAll("seed cards");
await refreshSearchIndex(box.root);
const queued = await createContainsBackfillJob(box.root);
queued
=> 2

const listing = await box.list("box/jobs");
listing.includes("contains-backfill.job.card")
=> true
```

The job card is frontmatter carrying the source, a description, and the item
refs:

```ts continue
const jobs = (await box.list("box/jobs")).split("\n").filter((f) => f.includes("contains-backfill.job.card"));
const job = await box.read(jobs[0]!);
job.startsWith("---\n")
=> true

job.includes("source: contains-backfill")
=> true

job.includes("Write the contains: field for 2 cards missing it.")
=> true

job.includes("ref: store/notes/A.memo.card")
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
await refreshSearchIndex(box2.root);
await createContainsBackfillJob(box2.root)
=> 0
```

```ts cleanup
await box2.cleanup();
```

## The index refresh runs whether or not a backfill job is pending

`refreshSearchIndex` is the box's only *scheduled* reconciliation of the
search index against the card tree (queries refresh lazily, so a box nobody
searches has no other). Its execution must not depend on the state of the job
queue: here a backfill job is already pending — the condition that used to
suppress the refresh — and a card added afterwards still reaches the index.

```ts
const box3 = await makeTmpBox({ git: true });
await box3.write("store/notes/A.memo.card", MEMO("alpha notes"));
box3.commitAll("seed");
await refreshSearchIndex(box3.root);
await createContainsBackfillJob(box3.root);

// A pending backfill job now blocks queueing another...
await createContainsBackfillJob(box3.root)
=> 0

// ...but the refresh still indexes the new card.
await box3.write("store/notes/Later.memo.card", MEMO("distinctive kumquat filing"));
box3.commitAll("add a card");
await refreshSearchIndex(box3.root)
=> true

const hits = await searchBox(box3.root, { query: "kumquat", mode: "text" });
hits.results.some((r) => r.path === "store/notes/Later.memo.card")
=> true
```

```ts cleanup
await box3.cleanup();
```

## A refresh that lost the search lock is not a refresh

`openSearchIndex` degrades under contention: it retries for a few seconds and
then serves the last persisted index *without reconciling anything*, flagged
`stale`. That is the right call for a query — slightly stale beats broken —
but it is not a refresh, and `bbx wakeup` skips the backfill step on a false
return precisely so a batch is never chosen from `contains` state that
predates the card tree. Losing the lock is likeliest exactly when this matters
most: the first run after deploy, when the reconciliation is large and slow.

```ts
const box4 = await makeTmpBox({ git: true });
await box4.write("store/notes/A.memo.card", MEMO("alpha notes"));
box4.commitAll("seed");

// Hold the search lock, as a concurrent query or a second wakeup would.
await acquireLock(searchLockPath(box4.root), { purpose: "doctest" });
await refreshSearchIndex(box4.root)
=> false

// Released, the same call reconciles and reports success.
await releaseLock(searchLockPath(box4.root));
await refreshSearchIndex(box4.root)
=> true
```

```ts cleanup
await box4.cleanup();
```

## The job filename is stamped in box time

The stamp is not decoration: the reactor reads it back as the card's age to
decide when this low-priority job has waited long enough, and `bbx health`
reads it to report a job that never drained. Both compare against
`getBoxTime`, so the stamp has to come from the same clock — a wall-time stamp
under a frozen test clock dates the card in the box's own future, and a job
that is never old is a job that is never overdue.

```ts
process.env.BBX_TIME = "2026-03-04T05:06:07Z";
const box5 = await makeTmpBox({ git: true });
await box5.write("store/notes/A.memo.card", MEMO("alpha notes"));
box5.commitAll("seed");
await refreshSearchIndex(box5.root);
await createContainsBackfillJob(box5.root);

const queuedName = (await box5.list("box/jobs")).split("\n").find((f) => f.includes("contains-backfill"));
queuedName
=> box/jobs/2026-03-04T05-06.contains-backfill.job.card
```

```ts cleanup
delete process.env.BBX_TIME;
await box5.cleanup();
```
