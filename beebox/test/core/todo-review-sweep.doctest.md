# The todo-review sweep (`core/todo/review-sweep.ts`)

Filesystem-tier doctests for `docs/implemented-plans/todo-annotation.md` Track 5b:
`computeTodoReviewSets` computes three sets of open todos (escalated /
stirring / stale). Only `stirring` needs a baseline (the day of the last
review); escalated and stale are recomputed fresh every pass. Since
`docs/plans/todos-ui.md` Track 7 the sweep writes nothing: `bbx engine
todo-review check` owns the baseline and the brief
(`test/cli/commands/todo-review.doctest.md`).

```ts setup
import { computeTodoReviewSets, boxTodayEpoch, toBriefItem } from "../../src/core/todo/review-sweep.js";
import { parseIsoDate } from "../../src/shared/todo-model.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";

const MEMO_FM = "status: new\ncreated: 2026-07-01T10:00:00Z\n";

function memo(body: string): string {
  return `---\n${MEMO_FM}---\n${body}`;
}

function setTime(iso: string): void {
  process.env.BBX_TIME = iso;
}

// America/Chicago is UTC-5 in July (CDT) — 2026-07-28T12:00Z is 07:00 local,
// still July 28th locally (same setup as todo-collect.doctest.md).
async function seedBox() {
  const box = await makeTmpBox({ git: true });
  await box.write("_config/box.json", JSON.stringify({ timezone: "America/Chicago" }));
  return box;
}

/** The sets' todo ids, swept with `since` as the stirring baseline (an ISO date; null = the box's first review). */
async function sweep(root: string, since: string | null) {
  const lastSweepEpoch = since === null ? 0 : (parseIsoDate(since) ?? 0);
  const sets = await computeTodoReviewSets(root, { lastSweepEpoch, todayEpoch: await boxTodayEpoch(root) });
  return JSON.stringify({
    escalated: sets.escalated.map((t) => t.id),
    stirring: sets.stirring.map((t) => t.id),
    stale: sets.stale.map((t) => t.id),
  });
}
```

## All sets empty

```ts
const box = await seedBox();
setTime("2026-07-28T12:00:00.000Z");
await box.write("store/a.memo.card", memo("Just a plain memo, no todos.\n"));
await sweep(box.root, null)
=> {"escalated":[],"stirring":[],"stale":[]}
```

## Escalated, stirring, stale, and the ones that don't qualify

Six todos on one card: past-due (escalated), already-started (stirring), a
future-dated one (quiet — not on the plate, excluded from every set), an
old undated one (stale), a recent undated one (not old enough — excluded),
and a `done` one with a past `due` (excluded — sets are open-todos only).

```ts continue
await box.write(
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
await sweep(box.root, null)
=> {"escalated":["fix-escalated"],"stirring":["fix-stirring"],"stale":["fix-stale"]}
```

## Stirring is relative to the baseline; escalated and stale are not

With a baseline after the stirring todo's `start`, it is no longer stirring;
the escalated and stale ones are still reported. A todo whose `start` falls
after the baseline is stirring again.

```ts continue
await sweep(box.root, "2026-07-25")
=> {"escalated":["fix-escalated"],"stirring":[],"stale":["fix-stale"]}

await sweep(box.root, "2026-07-19")
=> {"escalated":["fix-escalated"],"stirring":["fix-stirring"],"stale":["fix-stale"]}
```

## Each brief item says where it was written

What the card is, and the heading above it, so the brief reads in context
without the agent opening anything.

```ts continue
await box.write(
  "store/Porch.doc.card",
  "---\ntitle: Porch rebuild\n---\n## Decking\n\n{% todo id=\"deck\" due=\"2026-07-01\" %}Order lumber{% /todo %}\n"
);
const sets = await computeTodoReviewSets(box.root, { lastSweepEpoch: 0, todayEpoch: await boxTodayEpoch(box.root) });
JSON.stringify(toBriefItem(sets.escalated.find((t) => t.id === "deck"), "escalated"))
=> {"locator":"store/Porch.doc.card:6","text":"Order lumber","detail":"due 2026-07-01","card":"Porch rebuild","section":"Decking"}
```

```ts cleanup
await box.cleanup();
```

## Staleness compares box-local calendar days, not a raw UTC instant

`Pacific/Kiritimati` is UTC+14 — far enough ahead of UTC that a `BBX_TIME`
instant late in one UTC day already reads as the NEXT calendar day locally.
A `created` date exactly 45 UTC-instant-days before that raw instant is
46 box-local calendar days old (one more full day has turned over locally)
— comparing `created` against `now.getTime()` (a UTC instant) instead of the
box's own `todayEpoch` would call this todo not-yet-stale a day early
relative to the box's own calendar, the same class of bug the plate-state
truth table already guards against for `start`/`due`.

```ts
const boxTz = await makeTmpBox({ git: true });
await boxTz.write("_config/box.json", JSON.stringify({ timezone: "Pacific/Kiritimati" }));
setTime("2026-07-28T23:00:00.000Z"); // 2026-07-29, 13:00 local in Pacific/Kiritimati
await boxTz.write(
  "store/f.memo.card",
  memo('{% todo id="just-turned-stale" created="2026-06-13" %}Undated, aging{% /todo %}\n')
);
await sweep(boxTz.root, null)
=> {"escalated":[],"stirring":[],"stale":["just-turned-stale"]}
```

```ts cleanup
await boxTz.cleanup();
```

## A `recheck` still ahead, or `never`, keeps a todo out of every set

`recheck` is when the review said it would look again
(`docs/plans/todos-ui.md`, Track 7). Until that day the todo is left out of
whichever set it would otherwise be in; on the day, it is back. `never` keeps
it out for good. A done todo is out regardless.

```ts
const boxR = await seedBox();
setTime("2026-07-28T12:00:00.000Z");
await boxR.write(
  "store/r.memo.card",
  memo(
    '{% todo id="later" due="2026-07-01" recheck="2026-08-10" %}Escalated, recheck ahead{% /todo %}\n\n' +
    '{% todo id="today" due="2026-07-01" recheck="2026-07-28" %}Escalated, recheck today{% /todo %}\n\n' +
    '{% todo id="retired" created="2026-01-01" recheck="never" %}Stale, retired{% /todo %}\n\n' +
    '{% todo id="stir" start="2026-07-20" due="2026-08-15" recheck="2026-09-01" %}Stirring, recheck ahead{% /todo %}\n'
  )
);
await sweep(boxR.root, null)
=> {"escalated":["today"],"stirring":[],"stale":[]}
```

```ts cleanup
await boxR.cleanup();
```
