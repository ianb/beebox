# One wakeup cycle per box at a time

Only the reactor step used to be serialized (`core/reactor/engine.ts`), so `bbx
tick`, the Sync button, and a scheduled `bbx wakeup` could interleave
preprocessing, connectors and push — two processes staging the same tree and
each seeing half of the other's work. `runUnderWakeupCycleLock` puts the whole
cycle behind one per-box lock (`lib/file-lock.ts`, never `proper-lockfile`
directly).

A contended cycle does no work at all. It does not queue behind the first one:
a cycle that waited would then run against a box the first cycle had just
rewritten, which is the same interleaving one step later.

```ts setup
import {
  runUnderWakeupCycleLock,
  wakeupCycleLockPath,
  WAKEUP_ALREADY_RUNNING,
} from "../../../src/cli/commands/wakeup-cycle-lock.js";
import { parseWakeupOutcome, WAKEUP_OUTCOME_ENV } from "../../../src/cli/commands/wakeup-outcome.js";
import { inspectLock } from "../../../src/lib/file-lock.js";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";

/** Collect what the cycle printed instead of letting it reach the test output. */
async function capture(fn) {
  const original = console.log;
  const lines = [];
  console.log = (text) => lines.push(String(text));
  try {
    await fn();
  } finally {
    console.log = original;
  }
  return lines;
}
```

## The second cycle skips, and says so

The outer call models a wakeup that is mid-cycle; the inner one is a second
`bbx wakeup` arriving while it runs. The inner cycle's body never executes.

```ts
const box = await makeTmpBox();
process.env[WAKEUP_OUTCOME_ENV] = "1";

let secondCycleDidWork = false;
let secondCycleRan = null;
const printed = await capture(async () => {
  await runUnderWakeupCycleLock(box.root, async () => {
    secondCycleRan = await runUnderWakeupCycleLock(box.root, async () => {
      secondCycleDidWork = true;
    });
  });
});

`ran=${secondCycleRan}; didWork=${secondCycleDidWork}`
=> ran=false; didWork=false
```

It is one visible line, not a silent no-op — a skipped cycle that printed
nothing would read as a cycle that found nothing to do:

```ts continue
printed.filter((line) => line === WAKEUP_ALREADY_RUNNING).length
=> 1
```

## The outcome carries the skip

Every count is zero because nothing ran, so a supervisor that read only the
counts would take "0 errors, reactor ok" as an answer about work that never
started. `skipped` is what distinguishes the two.

```ts continue
const outcome = parseWakeupOutcome(printed.join("\n"));
JSON.stringify(outcome)
=> {"connectorErrors":0,"reactorOk":true,"reactorSkipped":false,"jobsProcessed":0,"jobsRemaining":0,"skipped":"wakeup-running"}
```

An unrecognized skip value is "no information", not a skip — the parser refuses
the whole line rather than passing a value callers cannot dispatch on:

```ts continue
parseWakeupOutcome(`[wakeup-outcome] ${JSON.stringify({ ...outcome, skipped: "something-else" })}`)
=> null
```

## The lock is released, so the next cycle runs normally

```ts continue
await inspectLock(wakeupCycleLockPath(box.root))
=> null

let thirdCycleDidWork = false;
await runUnderWakeupCycleLock(box.root, async () => { thirdCycleDidWork = true; });
=> true

thirdCycleDidWork
=> true
```

```ts cleanup
delete process.env[WAKEUP_OUTCOME_ENV];
await box.cleanup();
```
