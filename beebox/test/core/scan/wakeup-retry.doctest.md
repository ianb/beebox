# The wakeup retry budget

The promote worker re-arms itself whenever a pass ends incomplete, so a wakeup
that fails for a reason that will not go away turns into an infinite loop of
full `bbx wakeup` runs. This file pins the budget that ends it: the backoff
schedule, the point of abandonment, the durability that survives a restart, and
the rule that new scan files start the budget over.

```ts setup
import { makeTmpBox } from "../../helpers/doctest-helpers.js";
import {
  MAX_WAKEUP_ATTEMPTS,
  clearWakeupFailures,
  decideWakeupRetry,
  isWakeupAbandoned,
  readWakeupFailures,
  recordWakeupAbandoned,
  recordWakeupFailure,
} from "../../../src/core/scan/wakeup-retry.js";
import { markWakeupPending, runPendingWakeup } from "../../../src/core/scan/promote-wakeup.js";

const minutes = (ms) => ms / 60000;
```

## The backoff schedule, and where it stops

Each failure waits longer than the last, doubling from the settle window until
it hits the cap. The whole sequence is under an hour, so a transient outage
recovers on its own and a permanent one is abandoned inside a working session.

```ts
const attempts = Array.from({ length: MAX_WAKEUP_ATTEMPTS }, (_v, i) => i + 1);
const describe = (d) => (d.kind === "abandon" ? "abandon" : minutes(d.delayMs) + "m");
attempts.map((n) => describe(decideWakeupRetry(n))).join(" ")
=> 2m 4m 8m 15m 15m abandon
```

The retries total well under an hour of waiting:

```ts
const retries = Array.from({ length: MAX_WAKEUP_ATTEMPTS - 1 }, (_v, i) => decideWakeupRetry(i + 1));
const total = retries.reduce((sum, d) => sum + (d.kind === "retry" ? d.delayMs : 0), 0);
minutes(total) <= 60
=> true
```

## Failures accumulate on disk, so a restart does not hand out a fresh budget

The box that ran this loop in production restarts on deploy. An in-memory
counter would reset there, and the loop would resume.

```ts
const box = await makeTmpBox();
await recordWakeupFailure(box.root);
await recordWakeupFailure(box.root);
await readWakeupFailures(box.root)
=> 2
```

A second reader — a fresh process — sees the same count:

```ts continue
await readWakeupFailures(box.root)
=> 2
```

A corrupt or hand-edited counter reads as zero rather than throwing: the budget
is a guard, and a broken guard must not take the pipeline down with it.

```ts
const box = await makeTmpBox();
await recordWakeupFailure(box.root);
const { writeFile } = await import("node:fs/promises");
const { wakeupAttemptsPath } = await import("../../../src/core/scan/wakeup-retry.js");
await writeFile(wakeupAttemptsPath(box.root), "not a number\n");
await readWakeupFailures(box.root)
=> 0
```

## Abandonment is a state on disk, not just a log line

A log line rotates away; the boxholder needs to be able to see that this box
stopped trying, and why.

```ts
const box = await makeTmpBox();
await isWakeupAbandoned(box.root)
=> false
```

```ts continue
await recordWakeupAbandoned(box.root, { failures: 6, detail: "invalid_grant" });
await isWakeupAbandoned(box.root)
=> true
```

The record says what happened and what to do about it:

```ts continue
const { readFile } = await import("node:fs/promises");
const { wakeupAbandonedPath } = await import("../../../src/core/scan/wakeup-retry.js");
const text = await readFile(wakeupAbandonedPath(box.root), "utf-8");
[text.includes("abandoned after 6"), text.includes("invalid_grant"), text.includes("delete this file")].join(" ")
=> true true true
```

## A wakeup that keeps failing is tried a bounded number of times, then stopped

The end-to-end property: with a runner that always fails, the number of actual
`bbx wakeup` invocations is bounded, and the last outcome is `abandoned`
rather than another `failed` that would be re-armed.

```ts
const box = await makeTmpBox();
await markWakeupPending(box.root, { reason: "1 scan file(s) entering promote", newWork: true });

let calls = 0;
const alwaysFails = () => {
  calls++;
  return Promise.resolve({ ok: false, detail: "invalid_grant" });
};

const passes = Array.from({ length: 20 }, (_v, i) => i);
const outcomes = [];
await passes.reduce(
  (chain) =>
    chain.then(async () => {
      const outcome = await runPendingWakeup({ boxRoot: box.root, runWakeup: alwaysFails });
      outcomes.push(outcome.kind);
    }),
  Promise.resolve(),
);
"calls=" + calls + " last=" + outcomes[outcomes.length - 1]
=> calls=6 last=abandoned
```

Twenty passes produced six wakeups. Every pass after abandonment is a no-op,
which is what stops the loop:

```ts continue
outcomes.filter((k) => k === "abandoned").length
=> 15
```

## New scan files start the budget over

Otherwise one permanently-broken connector would silently strand every future
scan on the box — trading a loud loop for a quiet one.

```ts continue
await markWakeupPending(box.root, { reason: "2 scan file(s) entering promote", newWork: true });
await isWakeupAbandoned(box.root)
=> false
```

```ts continue
await readWakeupFailures(box.root)
=> 0
```

```ts continue
calls = 0;
const outcome = await runPendingWakeup({ boxRoot: box.root, runWakeup: alwaysFails });
"calls=" + calls + " kind=" + outcome.kind
=> calls=1 kind=failed
```

## A successful wakeup clears the history

A box that failed twice and then recovered starts its next incident with a full
budget, not a nearly-spent one.

```ts
const box = await makeTmpBox();
await markWakeupPending(box.root, { reason: "1 scan file(s) entering promote", newWork: true });
await runPendingWakeup({ boxRoot: box.root, runWakeup: () => Promise.resolve({ ok: false, detail: "x" }) });
await runPendingWakeup({ boxRoot: box.root, runWakeup: () => Promise.resolve({ ok: false, detail: "x" }) });
await readWakeupFailures(box.root)
=> 2
```

```ts continue
const ok = await runPendingWakeup({ boxRoot: box.root, runWakeup: () => Promise.resolve({ ok: true, detail: "" }) });
"kind=" + ok.kind + " failures=" + (await readWakeupFailures(box.root))
=> kind=ran failures=0
```

With the marker cleared, a later pass has nothing to do:

```ts continue
const after = await runPendingWakeup({ boxRoot: box.root, runWakeup: () => Promise.resolve({ ok: true, detail: "" }) });
after.kind
=> not-needed
```

## `clearWakeupFailures` is safe when nothing was ever recorded

```ts
const box = await makeTmpBox();
await clearWakeupFailures(box.root);
await readWakeupFailures(box.root)
=> 0
```

## A retry of already-counted work does not refresh the budget

A pass re-drives entries still stuck in `promoting` from a failed upload, and
marks the wakeup owed each time. If that reset the counter, the budget would
never reach abandonment and the bound would be decorative.

```ts
const box = await makeTmpBox();
await markWakeupPending(box.root, { reason: "1 scan file(s) entering promote", newWork: true });
await recordWakeupFailure(box.root);
await recordWakeupFailure(box.root);
await markWakeupPending(box.root, { reason: "1 scan file(s) entering promote", newWork: false });
await readWakeupFailures(box.root)
=> 2
```

Genuinely new files still reset it:

```ts continue
await markWakeupPending(box.root, { reason: "3 scan file(s) entering promote", newWork: true });
await readWakeupFailures(box.root)
=> 0
```
