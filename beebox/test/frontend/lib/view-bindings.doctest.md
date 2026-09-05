# view-bindings — single-flight cache with synchronous invalidation

`createSingleFlightCache` (`lib/view-bindings.ts`) backs the card-type →
custom-view bindings cache: concurrent `load()` calls share one in-flight
fetch, and `invalidate()` clears the cache immediately — not deferred to a
microtask — so an `invalidate()` followed by a `load()` in the same tick
always sees the cleared cache. An earlier revision routed the clear through
the shared `deferred-resync` coalescing helper, which delayed it to a
microtask; both of `useCardViewBinding`'s event handlers call `load()`
synchronously right after `invalidate()`, so that revision kept returning the
stale pre-invalidation promise and a changed view binding never actually
reloaded.

```ts setup
import { createSingleFlightCache } from "../../../src/frontend/src/lib/view-bindings.js";
```

## `invalidate()` then `load()` in the same tick returns post-invalidation data

```ts
let fetchCount = 0;
let value = "first";
const cache = createSingleFlightCache(async () => {
  fetchCount += 1;
  return value;
});

const before = await cache.load();
print(`before: ${before}, fetches: ${fetchCount}`);

value = "second";
cache.invalidate();
const after = await cache.load();
print(`after: ${after}, fetches: ${fetchCount}`);
=>
before: first, fetches: 1
after: second, fetches: 2
```

## Concurrent `load()` calls share one in-flight fetch

```ts
let fetchCount2 = 0;
const cache2 = createSingleFlightCache(async () => {
  fetchCount2 += 1;
  return "value";
});

const [a, b, c] = await Promise.all([cache2.load(), cache2.load(), cache2.load()]);
print(`fetches: ${fetchCount2}`);
print(`same: ${a === b && b === c}`);
=>
fetches: 1
same: true
```

## Repeated `invalidate()` calls are idempotent — no coalescing needed

Unlike a resync trigger with side effects worth deduplicating, clearing an
already-null cache is a plain no-op, so a burst of `invalidate()` calls (the
shape of many mounted views all reacting to one event) needs no special
handling: the next `load()` still just starts one fresh fetch.

```ts
let fetchCount3 = 0;
const cache3 = createSingleFlightCache(async () => {
  fetchCount3 += 1;
  return "value";
});

await cache3.load();
cache3.invalidate();
cache3.invalidate();
cache3.invalidate();
await cache3.load();
fetchCount3
=> 2
```
