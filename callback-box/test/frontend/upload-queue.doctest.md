# Upload queue

`UploadQueue` bounds how many uploads run at once, with a priority lane for
small near-live work (audio chunks) that must not wait behind a large photo.

Serializing is the whole point: six concurrent multi-megabyte uploads share one
uplink, so on a weak link none of them finishes before any per-request deadline
— they abort together and retry from byte zero. One at a time, each transfer
gets the whole pipe and stays done.

```ts setup
import { UploadQueue } from "../../src/frontend/src/lib/upload-queue.js";

/** A task that resolves only when told to, recording its start order. */
function makeTask(label, log) {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  return {
    release,
    run: () => { log.push(`start:${label}`); return gate.then(() => { log.push(`end:${label}`); }); },
  };
}

/** Let queued microtasks settle so starts/finishes land before we assert. */
const settle = () => new Promise((r) => setTimeout(r, 0));
```

## Concurrency 1 means one at a time

Three tasks are accepted immediately, but only the first runs. The second does
not start until the first has finished:

```ts
const log = [];
const q = new UploadQueue({ concurrency: 1 });
const a = makeTask("a", log), b = makeTask("b", log), c = makeTask("c", log);

const all = Promise.all([
  q.run(a.run, { priority: false }),
  q.run(b.run, { priority: false }),
  q.run(c.run, { priority: false }),
]);
await settle();
log.join(",")
=> start:a
```

Everything accepted is outstanding — one running, two waiting. That total is
what a drain has to wait for:

```ts continue
[q.inFlight, q.queued, q.outstanding].join("/")
=> 1/2/3
```

Releasing each in turn walks the queue in FIFO order:

```ts continue
a.release(); await settle();
b.release(); await settle();
c.release(); await settle();
await all;
log.join(",")
=> start:a,end:a,start:b,end:b,start:c,end:c
```

## Priority jumps the queue but never preempts

`a` is already running when a priority task arrives, so `a` is left alone — an
in-flight XHR cannot be paused without discarding the bytes it already sent,
which is the exact waste the queue exists to prevent. The priority task instead
goes ahead of the ordinary work still waiting:

```ts
const log = [];
const q = new UploadQueue({ concurrency: 1 });
const a = makeTask("photo-a", log), b = makeTask("photo-b", log);
const audio = makeTask("audio", log);

const all = Promise.all([
  q.run(a.run, { priority: false }),
  q.run(b.run, { priority: false }),
  q.run(audio.run, { priority: true }),
]);
await settle();
a.release(); await settle();
log.join(",")
=> start:photo-a,end:photo-a,start:audio
```

```ts continue
audio.release(); await settle();
b.release(); await settle();
await all;
log.join(",")
=> start:photo-a,end:photo-a,start:audio,end:audio,start:photo-b,end:photo-b
```

Two priority tasks keep their own arrival order rather than stacking in
reverse — audio chunks must land in the sequence they were recorded:

```ts
const log = [];
const q = new UploadQueue({ concurrency: 1 });
const blocker = makeTask("blocker", log);
const first = makeTask("audio-1", log), second = makeTask("audio-2", log);

const all = Promise.all([
  q.run(blocker.run, { priority: false }),
  q.run(first.run, { priority: true }),
  q.run(second.run, { priority: true }),
]);
await settle();
blocker.release(); await settle();
first.release(); await settle();
second.release(); await settle();
await all;
log.join(",")
=> start:blocker,end:blocker,start:audio-1,end:audio-1,start:audio-2,end:audio-2
```

## A failing task releases its slot

A rejection is the task's own outcome — `run` rejects with it, and the queue
keeps moving. (An upload that gave up must not wedge every upload behind it.)

```ts
const log = [];
const q = new UploadQueue({ concurrency: 1 });
const failing = q.run(() => Promise.reject(new Error("boom")), { priority: false });
const after = q.run(() => { log.push("ran-after"); return Promise.resolve("ok"); }, { priority: false });

const caught = await failing.then(() => "resolved", (e) => `rejected:${e.message}`);
[caught, await after, log.join(",")].join(" ")
=> rejected:boom ok ran-after
```

```ts continue
[q.inFlight, q.queued, q.outstanding].join("/")
=> 0/0/0
```

## Higher concurrency still bounds the fan-out

The class is not hard-wired to 1 — a concurrency of 2 admits exactly two:

```ts
const log = [];
const q = new UploadQueue({ concurrency: 2 });
const a = makeTask("a", log), b = makeTask("b", log), c = makeTask("c", log);
const all = Promise.all([
  q.run(a.run, { priority: false }),
  q.run(b.run, { priority: false }),
  q.run(c.run, { priority: false }),
]);
await settle();
[log.join(","), q.inFlight, q.queued].join(" | ")
=> start:a,start:b | 2 | 1
```

```ts continue
a.release(); b.release(); c.release();
await all;
q.outstanding
=> 0
```
