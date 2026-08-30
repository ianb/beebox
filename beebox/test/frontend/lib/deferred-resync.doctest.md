# deferred-resync — coalesced, visibility-aware resync trigger

`createDeferredResync` (`lib/deferred-resync.ts`) generalizes `view-bindings.ts`'s
hand-rolled microtask-coalescing guard and adds background-tab quiescence: a
`trigger()` call while the tab is hidden is parked, not dropped, and fires
exactly once — no matter how many triggers accumulated — the moment the tab
becomes visible.

A fake `VisibilityAdapter` stands in for `document`: the frontend doctests run
under plain Node (no jsdom), so there's no real `document.hidden` to flip.

```ts setup
import { createDeferredResync, type VisibilityAdapter } from "../../../src/frontend/src/lib/deferred-resync.js";

function makeFakeVisibility(): VisibilityAdapter & { setHidden: (hidden: boolean) => void } {
  let hiddenState = false;
  let listeners: Array<() => void> = [];
  return {
    isHidden: () => hiddenState,
    onVisible: (bbx) => {
      listeners.push(bbx);
      return () => { listeners = listeners.filter((l) => l !== bbx); };
    },
    setHidden(next: boolean) {
      const wasHidden = hiddenState;
      hiddenState = next;
      if (wasHidden && !next) {
        for (const l of listeners) l();
      }
    },
  };
}
```

## Same-tick calls collapse to one invocation

Several `trigger()` calls in the same synchronous tick — the shape of N
mounted components all reacting to one WS reconnect — run `fn` once, on the
next microtask.

```ts
let calls = 0;
const visibility = makeFakeVisibility();
const resync = createDeferredResync(() => { calls += 1; }, { visibility });

resync.trigger();
resync.trigger();
resync.trigger();
calls
=> 0

await Promise.resolve();
calls
=> 1
```

A trigger AFTER that microtask has fired schedules a fresh, independent run:

```ts continue
resync.trigger();
await Promise.resolve();
calls
=> 2
```

## Hidden tab: triggers are parked, not dropped

While `visibility.isHidden()` is true, `trigger()` doesn't schedule `fn` at
all — not even after a microtask turn:

```ts
let calls = 0;
const visibility = makeFakeVisibility();
visibility.setHidden(true);
const resync = createDeferredResync(() => { calls += 1; }, { visibility });

resync.trigger();
resync.trigger();
resync.trigger();
await Promise.resolve();
calls
=> 0
```

Becoming visible fires it exactly once, regardless of how many triggers piled
up while hidden:

```ts continue
visibility.setHidden(false);
await Promise.resolve();
calls
=> 1
```

A visibility transition with no pending trigger is a no-op:

```ts continue
visibility.setHidden(true);
visibility.setHidden(false);
await Promise.resolve();
calls
=> 1
```

## `alwaysVisible` skips deferral

Some state (`view-bindings.ts`'s module-level cache, feeding correctness for
code that isn't screen-driven) must stay current even while the tab is
backgrounded. `alwaysVisible: true` keeps same-tick coalescing but never parks:

```ts
let calls = 0;
const visibility = makeFakeVisibility();
visibility.setHidden(true);
const resync = createDeferredResync(() => { calls += 1; }, { visibility, alwaysVisible: true });

resync.trigger();
resync.trigger();
await Promise.resolve();
calls
=> 1
```

## Independent instances don't share state

Two `createDeferredResync` instances (the shape of two different resync
"keys" — e.g. FileView instances for two different paths) are entirely
independent: triggering one never invokes the other's `fn`, and each tracks
its own hidden/pending state.

```ts
let callsA = 0;
let callsB = 0;
const visibilityA = makeFakeVisibility();
const visibilityB = makeFakeVisibility();
visibilityB.setHidden(true);
const resyncA = createDeferredResync(() => { callsA += 1; }, { visibility: visibilityA });
const resyncB = createDeferredResync(() => { callsB += 1; }, { visibility: visibilityB });

resyncA.trigger();
resyncB.trigger();
await Promise.resolve();
[callsA, callsB].join(",")
=> 1,0

visibilityB.setHidden(false);
await Promise.resolve();
[callsA, callsB].join(",")
=> 1,1
```

## `dispose` detaches the visibility listener

After `dispose()`, a later visibility transition can't resurrect a pending
trigger — the instance is inert.

```ts
let calls = 0;
const visibility = makeFakeVisibility();
visibility.setHidden(true);
const resync = createDeferredResync(() => { calls += 1; }, { visibility });

resync.trigger();
resync.dispose();
visibility.setHidden(false);
await Promise.resolve();
calls
=> 0
```

## `dispose` cancels an already-queued microtask run

A `trigger()` schedules `run()` via `queueMicrotask` before the microtask
actually executes. If the caller (e.g. a component's unmount cleanup) calls
`dispose()` in that window — after `trigger()` queued the run but before the
microtask fires — the queued run must become a no-op, not invoke `fn` against
a torn-down caller:

```ts
let calls = 0;
const visibility = makeFakeVisibility();
const resync = createDeferredResync(() => { calls += 1; }, { visibility });

resync.trigger();
resync.dispose();
await Promise.resolve();
calls
=> 0
```

## A direct `trigger()` call after `dispose()` is also a no-op

Some callers (e.g. `useDeferredResync`'s returned `trigger` callback) may
hold the `trigger` function directly rather than going through the `resync`
object; disposal must make that reference inert too, not just future calls
made through `resync.trigger`:

```ts
let calls = 0;
const visibility = makeFakeVisibility();
const resync = createDeferredResync(() => { calls += 1; }, { visibility });
const { trigger } = resync;

resync.dispose();
trigger();
await Promise.resolve();
calls
=> 0
```
