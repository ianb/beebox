# Upload queue

`UploadQueue` bounds how many uploads run at once, with a separate lane for
small near-live work (audio chunks) that must not wait behind a large photo.

Bounding is the whole point: six concurrent multi-megabyte uploads share one
uplink, so on a weak link none of them finishes before any per-request deadline
— they abort together and retry from byte zero. One bulk transfer at a time, and
each gets essentially the whole pipe and stays done.

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
const q = new UploadQueue({ concurrency: 1, priorityConcurrency: 1 });
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

## The small lane runs alongside the bulk lane

An audio chunk does not wait for the photo that is already uploading. Inside a
single shared lane, "priority" could only jump the *waiting* line — a 40 KB chunk
behind a 10 MB photo would still sit out the whole photo, which on the link that
motivated this is minutes. Its own slot is what actually keeps audio near-live:

```ts
const log = [];
const q = new UploadQueue({ concurrency: 1, priorityConcurrency: 1 });
const photo = makeTask("photo", log);
const audio = makeTask("audio", log);

const all = Promise.all([
  q.run(photo.run, { priority: false }),
  q.run(audio.run, { priority: true }),
]);
await settle();
log.join(",")
=> start:photo,start:audio
```

Both are outstanding, one in each lane:

```ts continue
[q.inFlight, q.queued].join("/")
=> 2/0
```

The audio finishes while the photo is still going — the point of the split:

```ts continue
audio.release(); await settle();
log.join(",")
=> start:photo,start:audio,end:audio
```

```ts continue
photo.release(); await settle();
await all;
log.join(",")
=> start:photo,start:audio,end:audio,end:photo
```

A steady stream of small uploads cannot starve the bulk lane, because they draw
on different capacity. Here three audio chunks queue up in their own lane while
the photo proceeds untouched:

```ts
const log = [];
const q = new UploadQueue({ concurrency: 1, priorityConcurrency: 1 });
const photo = makeTask("photo", log);
const chunks = [makeTask("audio-1", log), makeTask("audio-2", log), makeTask("audio-3", log)];

const all = Promise.all([
  q.run(photo.run, { priority: false }),
  ...chunks.map((c) => q.run(c.run, { priority: true })),
]);
await settle();
[log.join(","), q.queued].join(" | ")
=> start:photo,start:audio-1 | 2
```

The photo is free to finish first even though audio work is still backed up:

```ts continue
photo.release(); await settle();
log.join(",")
=> start:photo,start:audio-1,end:photo
```

```ts continue
for (const c of chunks) { c.release(); await settle(); }
await all;
log.join(",")
=> start:photo,start:audio-1,end:photo,end:audio-1,start:audio-2,end:audio-2,start:audio-3,end:audio-3
```

Within the small lane, chunks keep their arrival order — audio must land in the
sequence it was recorded:

```ts
const log = [];
const q = new UploadQueue({ concurrency: 1, priorityConcurrency: 1 });
const first = makeTask("audio-1", log), second = makeTask("audio-2", log), third = makeTask("audio-3", log);

const all = Promise.all([
  q.run(first.run, { priority: true }),
  q.run(second.run, { priority: true }),
  q.run(third.run, { priority: true }),
]);
await settle();
first.release(); await settle();
second.release(); await settle();
third.release(); await settle();
await all;
log.join(",")
=> start:audio-1,end:audio-1,start:audio-2,end:audio-2,start:audio-3,end:audio-3
```

## A failing task releases its slot

A rejection is the task's own outcome — `run` rejects with it, and the queue
keeps moving. (An upload that gave up must not wedge every upload behind it.)

```ts
const log = [];
const q = new UploadQueue({ concurrency: 1, priorityConcurrency: 1 });
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

The bulk lane is not hard-wired to 1 — a concurrency of 2 admits exactly two:

```ts
const log = [];
const q = new UploadQueue({ concurrency: 2, priorityConcurrency: 1 });
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
