# Batch settle: a scan session is one promote, not one per file

A ten-page scan session arrives as a burst of PUTs. Promoting each as it lands
would mean ten scan-import runs and ten wakeups, so the worker waits for the
burst to end: every upload re-arms the settle window, and the pass runs once no
new file has arrived for it.

The window here is milliseconds rather than the production two minutes; the
behavior under test is the re-arming, not the duration.

```ts setup
import { createPromoteDebouncer, SCAN_SETTLE_MS } from "../../../src/core/scan/promote-debounce.js";
import Fastify from "fastify";
import { startScanPromoteLifecycle } from "../../../src/webapp/routes/scan-promote-lifecycle.js";
import { sleep } from "../../../src/lib/sleep.js";

function counting(opts) {
  const state = { runs: 0 };
  state.debouncer = createPromoteDebouncer({
    settleMs: opts.settleMs,
    label: "test-box",
    run: async () => {
      state.runs++;
    },
  });
  return state;
}
```

## Two uploads inside the window produce one pass

```ts
const c = counting({ settleMs: 250 });
c.debouncer.notify();
await sleep(80);
c.debouncer.notify();

// Still inside the window measured from the SECOND upload.
await sleep(150);
c.runs
=> 0

await sleep(400);
c.runs
=> 1
```

Nothing re-fires once the batch has settled — the pass runs when work arrives,
not on a timer:

```ts continue
await sleep(300);
c.runs
=> 1

c.debouncer.cancel();
```

## A cancelled debouncer never fires

Server close must not leave a promote pass scheduled against a box that is
shutting down.

```ts
const c = counting({ settleMs: 100 });
c.debouncer.notify();
c.debouncer.cancel();
await sleep(300);
c.runs
=> 0

// And a notify after cancel stays cancelled.
c.debouncer.notify();
await sleep(300);
c.runs
=> 0
```

## The production window is the plan's two minutes

```ts
SCAN_SETTLE_MS
=> 120000
```

## Server close waits for a pass already in flight

The startup pass is fire-and-forget so a box can serve immediately. Closing the
server must still wait for that pass before its temporary box is removed.

```ts
const app = Fastify();
let release!: () => void;
let started!: () => void;
const passStarted = new Promise(resolve => { started = resolve; });
const passMayFinish = new Promise(resolve => { release = resolve; });
startScanPromoteLifecycle({
  server: app,
  boxRoot: "test-box",
  run: async () => { started(); await passMayFinish; },
});
await app.ready();
await passStarted;
let closingSettled = false;
const closing = app.close().then(() => { closingSettled = true; });
await sleep(20);
closingSettled
=> false
```

```ts continue
release();
await closing;
closingSettled
=> true
```
