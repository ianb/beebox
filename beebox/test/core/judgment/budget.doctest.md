# The Jev budget: a daily cap on `bbx judge` calls

A box may make at most 500 Jev calls per box-local day
(`src/core/judgment/budget.ts`), counted in `.beebox/jev-budget.json`. A run
reserves its calls all at once, so a batch never half-runs. Over the cap
`bbx judge` defers with the reason `budget`, which keeps a schedule's change
cursor; the health check counts those deferrals over the last 24 hours. See
docs/plans/notifications.md (Track D).

```ts setup
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { JEV_DAILY_CAP, jevBudgetHealthCheck, reserveJevCalls } from "../../../src/core/judgment/budget.js";
import { runJudge } from "../../../src/cli/commands/judge.js";
import { createFakeJev } from "../../../src/services/jev.js";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";

const NOON = new Date("2026-09-26T12:00:00Z");
const hours = (h) => new Date(NOON.getTime() + h * 60 * 60 * 1000);
```

## Reservations count up to the cap, all or none

```ts
const box = await makeTmpBox();
JEV_DAILY_CAP
=> 500

await reserveJevCalls(box.root, { calls: 490, now: NOON })
=> true

await reserveJevCalls(box.root, { calls: 20, now: NOON })
=> false

await reserveJevCalls(box.root, { calls: 10, now: NOON })
=> true

const stored = JSON.parse(await box.read(".beebox/jev-budget.json"));
`${stored.calls} ${stored.deferrals.length}`
=> 500 1
```

The refused reservation is a deferral the health check reports:

```ts continue
const check = await jevBudgetHealthCheck(box.root, { now: NOON });
`${check.name} ${check.ok}: ${check.message}`
=> jev-budget false: 1 judgment run(s) deferred in the last 24 hours because the box reached its daily cap of 500 Jev calls; their schedules retry with the same items
```

The next box-local day starts from zero, and a day after the deferral the
check is clear again.

```ts continue
await reserveJevCalls(box.root, { calls: 500, now: hours(24) })
=> true

(await jevBudgetHealthCheck(box.root, { now: hours(25) })).ok
=> true
```

```ts cleanup
await box.cleanup();
```

## `bbx judge` over the cap defers with `budget`

No call is made. The marker says `budget`, and the tick keeps the schedule's
cursor for that reason, so the same items are judged when budget returns.

```ts
const box = await makeTmpBox();
await box.write("_config/judgments/any.judgment.card", `---
questions:
  worth:
    type: noul
    criteria:
      true: "Something here is worth an agent's look."
      false: "Nothing is."
---
The state is the cards that changed since the last check.
`);
for (let i = 0; i < 5; i++) await reserveJevCalls(box.root, { calls: 100, now: new Date() });
const dir = await fs.mkdtemp(path.join(os.tmpdir(), "bbx-budget-"));
const BBX_DEFER_FILE = path.join(dir, "defer.json");
const jev = createFakeJev();
const errors = [];
const origErr = console.error;
console.error = (...args) => { errors.push(args.join(" ")); };
const code = await runJudge({ boxRoot: box.root, cardPath: "_config/judgments/any.judgment.card", options: { min: [], choice: [] }, stdin: "x".repeat(400), env: { BBX_DEFER_FILE }, jev });
console.error = origErr;
`${code} ${jev.judgeCalls.length} ${errors.join(" | ")}`
=> 75 0 bbx judge: deferred (budget): 1 call(s) would pass the box's daily Jev cap

await fs.readFile(BBX_DEFER_FILE, "utf-8")
=> {"reason":"budget"}
```

```ts cleanup
await fs.rm(dir, { recursive: true, force: true });
await box.cleanup();
```
