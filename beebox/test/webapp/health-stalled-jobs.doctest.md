# health: stalled job cards

Three job cards sat pending on a production box for 85, 52 and 40 days while
every other signal read healthy — the reactor skipped them (all low-priority,
and `bbx wakeup` runs with `skipLowPriority`) and nothing anywhere said so.
The reactor now bounds how long low-priority work may wait, but a job can
stall for other reasons: a failing agent, a connector-scoped wakeup that
never sees that job's source, a hand-written card. `stalledJobsCheck` reports
the fact — a job is old — independent of the reason, so the class of
failure is visible even when a future one has a cause we haven't met yet.

```ts setup
import { stalledJobsCheck } from "../../src/webapp/trpc/routers/health-stale.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
import { createIntakeJobTemplate } from "../../src/schemas/index.js";

const job = (description: string) =>
  createIntakeJobTemplate({ source: "test", description, items: [] });

// Matches the `YYYY-MM-DDTHH-MM-SS` stamp every job-card writer uses, built
// relative to "now" so the doctest never goes stale as the calendar moves.
const stampFromNow = (msAgo: number) =>
  new Date(Date.now() - msAgo).toISOString().replace(/:/g, "-").replace(/\.\d+Z$/, "");
```

## A box with no jobs, and a box with fresh ones, both pass

Age is read from the filename's timestamp prefix, which every job-card writer
stamps.

```ts
const box = await makeTmpBox({ git: true });
const empty = await stalledJobsCheck(box.root);
JSON.stringify({ ok: empty.ok, severity: empty.severity })
=> {"ok":true,"severity":"warning"}

await box.write(`_bookkeeping/jobs/${stampFromNow(0)}-fresh.intake.job.card`, job("Today's work"));
(await stalledJobsCheck(box.root)).ok
=> true
```

```ts cleanup
await box.cleanup();
```

## A job pending past a week is reported, oldest first

`warning`, never `error`: a backlog is a nudge and must not fail a deploy or
take a box offline.

```ts
const boxOld = await makeTmpBox({ git: true });
await boxOld.write("_bookkeeping/jobs/2020-03-01T00-00-00-b.intake.job.card", job("Second oldest"));
await boxOld.write("_bookkeeping/jobs/2020-01-01T00-00-00-a.intake.job.card", job("Oldest"));
const check = await stalledJobsCheck(boxOld.root);
JSON.stringify({ ok: check.ok, severity: check.severity })
=> {"ok":false,"severity":"warning"}

check.message.startsWith("2 job(s) pending over 7 days: 2020-01-01T00-00-00-a.intake.job.card")
=> true
```

The message names the reactor as the thing to look at, since that is what
isn't draining them.

```ts continue
check.message.includes("bbx wakeup")
=> true
```

```ts cleanup
await boxOld.cleanup();
```

## An unstamped filename reads as young, not as stalled

A hand-written or legacy job name has no timestamp; its age falls back to the
file's mtime, and when even that is unavailable the card is left out rather
than assumed old. A check that cried stale over an unknowable age would be
noise, and noise is how the original three cards stayed invisible.

```ts
const boxPlain = await makeTmpBox({ git: true });
await boxPlain.write("_bookkeeping/jobs/handwritten.intake.job.card", job("No stamp"));
(await stalledJobsCheck(boxPlain.root)).ok
=> true
```

```ts cleanup
await boxPlain.cleanup();
```
