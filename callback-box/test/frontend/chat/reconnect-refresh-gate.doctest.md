# reconnect-refresh-gate — rate-gating reconnect-driven chat REFRESHes

`createReconnectRefreshGate` (`components/chat/reconnect-refresh-gate.ts`)
caps how often a WS reconnect is allowed to trigger a full chat history
REFRESH: at most once per `minIntervalMs`, counted from a baseline (mount
time) before the first real REFRESH. A flapping socket that reconnects
faster than the window can't produce a REFRESH per flap — only the earlier
first-connect-vs-mount-time check did that; this applies the same window to
every later reconnect too.

```ts setup
import { createReconnectRefreshGate } from "../../../src/frontend/src/components/chat/reconnect-refresh-gate.js";

function fakeClock(startAt: number) {
  let t = startAt;
  return { now: () => t, advance: (ms: number) => { t += ms; } };
}
```

## A connect within the window of the baseline is suppressed

Mirrors the original "first connect shortly after mount" case: mount's own
bootstrap already loaded history, so an immediate reconnect is redundant.

```ts
const clock = fakeClock(1_000);
const gate = createReconnectRefreshGate({ minIntervalMs: 5000, baselineAt: 1_000, now: clock.now });

clock.advance(1000);
gate.shouldRefresh()
=> false
```

## A connect past the window fires, and becomes the new baseline

```ts continue
clock.advance(4500);
gate.shouldRefresh()
=> true
```

## Every later reconnect is gated too, not just the first

A flapping socket reconnecting 200ms after the last REFRESH is suppressed —
this is the bug fix: the old code only checked elapsed-since-mount once, so
every reconnect after the first sent an unconditional REFRESH.

```ts continue
clock.advance(200);
gate.shouldRefresh()
=> false

clock.advance(200);
gate.shouldRefresh()
=> false
```

Once enough time has passed since the last actual REFRESH (not since mount),
it fires again:

```ts continue
clock.advance(5000);
gate.shouldRefresh()
=> true
```

## A connect exactly at the boundary is not yet due

`minIntervalMs` is a floor — exactly at the boundary hasn't cleared it (the
next tick will).

```ts
const clock2 = fakeClock(0);
const gate2 = createReconnectRefreshGate({ minIntervalMs: 5000, baselineAt: 0, now: clock2.now });

clock2.advance(5000);
gate2.shouldRefresh()
=> true

clock2.advance(4999);
gate2.shouldRefresh()
=> false
```
