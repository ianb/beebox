# Batch settle: a scan session is one promote, not one per file

A ten-page scan session arrives as a burst of PUTs. Promoting each as it lands
would mean ten scan-import runs and ten wakeups, so the worker waits for the
burst to end: every upload re-arms the settle window, and the pass runs once no
new file has arrived for it.

The window here is milliseconds rather than the production two minutes; the
behavior under test is the re-arming, not the duration.

```ts setup
import { createPromoteDebouncer } from "../../../src/core/scan/promote-debounce.js";
import Fastify from "fastify";
import { startScanPromoteLifecycle } from "../../../src/webapp/routes/scan-upload/promote-lifecycle.js";
import { setTimeout as sleep } from "node:timers/promises";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";
import { acquireBoxWork, boxWorkEnvironment } from "../../../src/lib/box-maintenance.js";

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

## Server close waits for a pass already in flight

The startup pass is fire-and-forget so a box can serve immediately. Closing the
server must still wait for that pass before its temporary box is removed.

```ts
const box = await makeTmpBox({ git: true });
const app = Fastify();
let release!: () => void;
let started!: () => void;
const passStarted = new Promise(resolve => { started = resolve; });
const passMayFinish = new Promise(resolve => { release = resolve; });
startScanPromoteLifecycle({
  server: app,
  boxRoot: box.root,
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

await box.cleanup();
```

## A pass takes its own work permit, not the one that armed it

An upload request arms the pass while it holds the request's work permit, and
timers carry async context. A pass that ran under that inherited permit would
outlive it: once the request released, every write in the pass, and every
child it spawned, failed with "Work permission has expired" on every retry.

Here the request arms a timer, as the upload route arms the settle window. The
timer starts the lifecycle after the request has released, and the pass hands
its permit to a child, as `bbx wakeup` or the commit hook would receive it.

```ts
const box = await makeTmpBox({ git: true });
const app = Fastify();
const request = await acquireBoxWork(box.root, { reason: "PUT /scan-upload" });
let childSaw!: (outcome: string) => void;
const outcome = new Promise(resolve => { childSaw = resolve; });
const armed = new Promise(resolve => request.run(() => setTimeout(() => {
  startScanPromoteLifecycle({
    server: app,
    boxRoot: box.root,
    run: async () => {
      const inherited = boxWorkEnvironment().BBX_BOX_WORK;
      childSaw(await acquireBoxWork(box.root, { reason: "bbx wakeup", inherited }).then(
        async (work) => { await work.release(); return "admitted"; },
        (error) => error.message,
      ));
    },
  });
  resolve(undefined);
}, 50)));
await request.release();
await armed;
await Promise.race([outcome, sleep(5000).then(() => "the pass never ran")])
=> admitted

await app.close();
await box.cleanup();
```
