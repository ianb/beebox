# The todo-review sweep (`core/todo/review-sweep.ts`)

Filesystem-tier doctests for `docs/plans/todo-annotation.md` Track 5b:
`runTodoReviewSweep(boxRoot)` computes three sets of open todos (escalated /
stirring / stale) and, when any is nonempty, queues a `todo-review-job` card
— the compact brief that reaches the reactor. All-empty does nothing at all;
only `stirring` needs the persisted `lastSweepAt` baseline (escalated/stale
are recomputed fresh every pass).

```ts setup
import { runTodoReviewSweep } from "../../src/core/todo/review-sweep.js";
import { findJobCards } from "../../src/core/reactor/job-discovery.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";

const MEMO_FM = "status: new\ncreated: 2026-07-01T10:00:00Z\n";

function memo(body: string): string {
  return `---\n${MEMO_FM}---\n${body}`;
}

function setTime(iso: string): void {
  process.env.CB_TIME = iso;
}

// America/Chicago is UTC-5 in July (CDT) — 2026-07-28T12:00Z is 07:00 local,
// still July 28th locally (same setup as todo-collect.doctest.md).
async function seedBox() {
  const box = await makeTmpBox({ git: true });
  await box.write("config/box.json", JSON.stringify({ timezone: "America/Chicago" }));
  return box;
}

async function jobFiles(box: { root: string }) {
  return findJobCards(path.join(box.root, "box/jobs"), { sourceFilter: "todo-review" });
}
```

## All sets empty: no job, no side effect

```ts
const box = await seedBox();
setTime("2026-07-28T12:00:00.000Z");
await box.write("store/a.memo.card", memo("Just a plain memo, no todos.\n"));

const result = await runTodoReviewSweep(box.root);
JSON.stringify({ escalated: result.escalated.length, stirring: result.stirring.length, stale: result.stale.length, jobPath: result.jobPath })
=> {"escalated":0,"stirring":0,"stale":0,"jobPath":null}

(await jobFiles(box)).length
=> 0
```

## Escalated, stirring, stale, and the ones that don't qualify

Six todos on one card: past-due (escalated), already-started (stirring), a
future-dated one (quiet — not on the plate, excluded from every set), an
old undated one (stale), a recent undated one (not old enough — excluded),
and a `done` one with a past `due` (excluded — sets are open-todos only).

```ts continue
const box2 = await seedBox();
setTime("2026-07-28T12:00:00.000Z");
await box2.write(
  "store/b.memo.card",
  memo(
    '{% todo id="fix-escalated" due="2026-07-01" %}Escalated item{% /todo %}\n\n' +
    '{% todo id="fix-stirring" start="2026-07-20" due="2026-08-01" %}Stirring item{% /todo %}\n\n' +
    '{% todo id="fix-quiet" start="2026-08-05" due="2026-08-10" %}Quiet item{% /todo %}\n\n' +
    '{% todo id="fix-stale" created="2026-06-01" %}Stale item{% /todo %}\n\n' +
    '{% todo id="fix-fresh" created="2026-07-20" %}Fresh undated item{% /todo %}\n\n' +
    '{% todo id="fix-done" status="done" due="2026-07-01" %}Done item{% /todo %}\n'
  )
);

const result2 = await runTodoReviewSweep(box2.root);
JSON.stringify({
  escalated: result2.escalated.map((t) => t.id),
  stirring: result2.stirring.map((t) => t.id),
  stale: result2.stale.map((t) => t.id),
})
=> {"escalated":["fix-escalated"],"stirring":["fix-stirring"],"stale":["fix-stale"]}
```

A job card got queued, carrying the compact brief:

```ts continue
result2.jobPath !== null
=> true

const jobContent = await fs.readFile(path.join(box2.root, result2.jobPath), "utf-8");
jobContent.includes("Escalated item")
=> true

jobContent.includes("Stirring item")
=> true

jobContent.includes("Stale item")
=> true

jobContent.includes("Quiet item")
=> false

jobContent.includes("Fresh undated item")
=> false

jobContent.includes("Done item")
=> false

(await jobFiles(box2)).length
=> 1
```

## Stirring dedups on the next sweep; escalated/stale don't

Once the job is cleared (simulating `cb finish`), a second sweep at the
same moment still reports the still-escalated and still-stale items — but
NOT the stirring one, because its `start` already crossed before the first
sweep's `lastSweepAt` baseline.

```ts continue
await fs.rm(path.join(box2.root, result2.jobPath));

const result3 = await runTodoReviewSweep(box2.root);
JSON.stringify({
  escalated: result3.escalated.map((t) => t.id),
  stirring: result3.stirring.map((t) => t.id),
  stale: result3.stale.map((t) => t.id),
})
=> {"escalated":["fix-escalated"],"stirring":[],"stale":["fix-stale"]}

result3.jobPath !== null
=> true
```

A *new* todo whose `start` crosses after that baseline still gets reported
as stirring on the next sweep:

```ts continue
await fs.rm(path.join(box2.root, result3.jobPath));
await box2.write(
  "store/c.memo.card",
  memo('{% todo id="fix-new-start" start="2026-07-29" due="2026-08-15" %}Newly on the plate{% /todo %}\n')
);

setTime("2026-07-30T12:00:00.000Z");
const result4 = await runTodoReviewSweep(box2.root);
JSON.stringify(result4.stirring.map((t) => t.id))
=> ["fix-new-start"]
```
