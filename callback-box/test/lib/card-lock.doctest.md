# In-process per-card write serialization

`withCardLock(path, fn)` funnels every read-modify-write for one file through
a per-file promise chain, so two overlapping mutations on the same card can't
both read the pre-mutation bytes and clobber each other's write. It is the
in-process counterpart to the cross-process `file-lock.ts` — no lock file, no
other process, just async tasks within one Node process.

```ts setup
import {
  withCardLock,
  activeCardLockCount,
  ReentrantCardLockError,
} from "../../src/lib/card-lock.js";

// A promise we resolve by hand, to hold a critical section open across an
// awaited yield so interleaving is deterministic (no wall-clock timers).
function deferred() {
  let resolve = () => {};
  const promise = new Promise<void>((r) => { resolve = r; });
  return { promise, resolve };
}

// Flush the microtask/immediate queue so queued chain work and the
// drain-cleanup callback have run before we assert.
const tick = () => new Promise((r) => setImmediate(r));
```

## Serialization order

A second acquisition for the same file waits until the first's callback fully
completes — it does not start while the first still holds the lock:

```ts
const events: string[] = [];
const gateA = deferred();

const pA = withCardLock("/box/todo.card", async () => {
  events.push("A:start");
  await gateA.promise;
  events.push("A:end");
});
const pB = withCardLock("/box/todo.card", async () => {
  events.push("B:start");
});

await tick();
events.join(",")
=> A:start

gateA.resolve();
await Promise.all([pA, pB]);
events.join(",")
=> A:start,A:end,B:start
```

## Key normalization — different spellings share one lock

`path.resolve` collapses relative/`.`/`..`/redundant-separator spellings, so a
file reached two ways still serializes:

```ts
const order: string[] = [];
const gate = deferred();

const p1 = withCardLock("/box/x.card", async () => {
  order.push("1:start");
  await gate.promise;
  order.push("1:end");
});
const p2 = withCardLock("/box/sub/../x.card", async () => {
  order.push("2:start");
});

await tick();
order.join(",")
=> 1:start

gate.resolve();
await Promise.all([p1, p2]);
order.join(",")
=> 1:start,1:end,2:start
```

## Distinct files run concurrently

Locks are per file; a lock on one card never blocks work on another:

```ts
const order: string[] = [];
const gate = deferred();

const pa = withCardLock("/box/a.card", async () => {
  order.push("a:start");
  await gate.promise;
  order.push("a:end");
});
const pb = withCardLock("/box/b.card", async () => {
  order.push("b:start");
});

await tick();
// b did not queue behind a — it ran while a is still holding.
order.join(",")
=> a:start,b:start

gate.resolve();
await Promise.all([pa, pb]);
"done"
=> done
```

## An error in the callback doesn't poison the chain

The failing task's rejection reaches its own caller, but the next queued task
still runs, and a normal callback's return value passes straight through:

```ts
const order: string[] = [];

const bad = withCardLock("/box/c.card", async () => {
  order.push("bad");
  throw new Error("boom");
});
const good = withCardLock("/box/c.card", async () => {
  order.push("good");
  return 42;
});

const err = await bad.catch((e) => (e as Error).message);
const value = await good;
[err, value, order.join(",")]
=> [
  "boom",
  42,
  "bad,good"
]
```

## Reentrancy is forbidden — it throws instead of deadlocking

A callback that re-acquires the SAME file's lock from within itself can never
progress (the inner acquisition queues behind the outer, which is waiting on
the inner). Rather than hang silently, `withCardLock` throws
`ReentrantCardLockError`:

```ts
const outcome = await withCardLock("/box/d.card", async () => {
  return withCardLock("/box/d.card", async () => "inner")
    .then(() => "no-throw", (e) => (e as Error).name);
});
outcome
=> ReentrantCardLockError

const err = await withCardLock("/box/d.card", async () => {
  return withCardLock("/box/d.card", async () => "x");
}).catch((e) => e);
err instanceof ReentrantCardLockError
=> true
```

Locking a *different* file from within a locked callback is fine — only
same-key nesting deadlocks:

```ts
const out = await withCardLock("/box/e.card", async () => {
  const inner = await withCardLock("/box/f.card", async () => "inner-ok");
  return `outer-got:${inner}`;
});
out
=> outer-got:inner-ok
```

## Entries drain — the map doesn't leak

The per-file chain is removed once it fully drains (compare-and-delete of the
tail), so the map holds only files with active or queued work, never every
file ever touched:

```ts
await tick();
activeCardLockCount()
=> 0

const gate = deferred();
const p = withCardLock("/box/drain.card", async () => { await gate.promise; });
activeCardLockCount()
=> 1

gate.resolve();
await p;
await tick();
activeCardLockCount()
=> 0
```
