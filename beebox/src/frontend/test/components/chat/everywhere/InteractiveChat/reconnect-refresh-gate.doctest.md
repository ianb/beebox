# reconnect-refresh-gate — rate-gating reconnect-driven chat REFRESHes

`createReconnectRefreshGate` (`components/chat/reconnect-refresh-gate.ts`)
caps how often a WS reconnect is allowed to trigger a full chat history
REFRESH: at most once per `minIntervalMs`, counted from a baseline (mount
time) before the first real REFRESH. A flapping socket that reconnects
faster than the window can't produce a REFRESH per flap — only the earlier
first-connect-vs-mount-time check did that; this applies the same window to
every later reconnect too.

A reconnect suppressed inside the window is not dropped: it arms a trailing
timer for the window's end, so the socket's last word is always eventually
serviced.

```ts setup
import { createReconnectRefreshGate } from "../../../../../src/components/chat/everywhere/InteractiveChat/reconnect-refresh-gate.js";

// A fake clock + timer scheduler so trailing-timer behavior is testable
// without real wall-clock waits. `advance` moves the clock and fires any
// timer whose deadline has been reached, in deadline order.
function fakeClock(startAt: number) {
  let t = startAt;
  let nextId = 1;
  const timers: Array<{ id: number; dueAt: number; fn: () => void }> = [];
  return {
    now: () => t,
    setTimeout: (fn: () => void, delayMs: number) => {
      const id = nextId++;
      timers.push({ id, dueAt: t + delayMs, fn });
      return id;
    },
    clearTimeout: (id: number) => {
      const idx = timers.findIndex((tm) => tm.id === id);
      if (idx !== -1) timers.splice(idx, 1);
    },
    advance: (ms: number) => {
      t += ms;
      const due = timers.filter((tm) => tm.dueAt <= t).sort((a, b) => a.dueAt - b.dueAt);
      for (const tm of due) {
        const idx = timers.indexOf(tm);
        if (idx !== -1) timers.splice(idx, 1);
        tm.fn();
      }
    },
    pendingCount: () => timers.length,
  };
}

/** A gate (5s window) on a fake clock; `reconnect()` notifies with a counting REFRESH. */
function makeGate(startAt: number) {
  const clock = fakeClock(startAt);
  const gate = createReconnectRefreshGate({
    minIntervalMs: 5000, baselineAt: startAt,
    now: clock.now, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
  });
  const state = { refreshes: 0 };
  return { clock, gate, state, reconnect: () => gate.notifyReconnect(() => { state.refreshes += 1; }) };
}
```

## A connect within the window of the baseline is suppressed (but scheduled)

Mirrors the original "first connect shortly after mount" case: mount's own
bootstrap already loaded history, so an immediate reconnect is redundant —
but it's not lost, it just waits for the rest of the window.

```ts
const { clock, state, reconnect } = makeGate(1_000);

clock.advance(1000);
reconnect();
state.refreshes
=> 0
```

## A connect past the window fires immediately, and becomes the new baseline

```ts continue
clock.advance(4500);
reconnect();
state.refreshes
=> 1
```

## Every later reconnect is gated too, not just the first

A flapping socket reconnecting 200ms after the last REFRESH is suppressed —
this is the bug fix: the old code only checked elapsed-since-mount once, so
every reconnect after the first sent an unconditional REFRESH.

```ts continue
clock.advance(200);
reconnect();
clock.advance(200);
reconnect();
state.refreshes
=> 1
```

Once enough time has passed since the last actual REFRESH (not since mount),
it fires again:

```ts continue
clock.advance(5000);
reconnect();
state.refreshes
=> 2
```

## A connect exactly at the boundary is not yet due

`minIntervalMs` is a floor — exactly at the boundary hasn't cleared it (the
next tick will).

```ts
const { clock, state, reconnect } = makeGate(0);

clock.advance(5000);
reconnect();
state.refreshes
=> 1

clock.advance(4999);
reconnect();
state.refreshes
=> 1
```

## Reconnect at t=4.9s then a stable connection: the refresh still fires once, at ~t=5s

The scenario that used to lose history for good: an outage exceeds event-bus
retention, the socket reconnects near the end of the window, and then stays
up — no further reconnect ever arrives to "get lucky" past the gate. The
trailing timer is what still services it. The connection stays stable — no
further `notifyReconnect` call — but the armed timer still fires once the
window elapses:

```ts
const { clock, state, reconnect } = makeGate(0);

clock.advance(4900);
reconnect();
state.refreshes
=> 0

clock.advance(99);
state.refreshes
=> 0

clock.advance(1);
state.refreshes
=> 1
```

Further reconnects that land before the timer fires coalesce into the same
single pending timer rather than each pushing the deadline back out. Advancing
to the ORIGINAL deadline (not pushed out by the second reconnect) fires it:

```ts
const { clock, state, reconnect } = makeGate(0);

clock.advance(4900);
reconnect();
clock.advance(50);
// Still suppressed; coalesces into the already-pending timer rather than re-arming it.
reconnect();
clock.pendingCount()
=> 1

clock.advance(50);
state.refreshes
=> 1
```

## `dispose` cancels the pending trailing refresh

Unmount (or a session switch remounting the hook) must not let a stale timer
fire into a torn-down closure.

```ts
const { clock, gate, state, reconnect } = makeGate(0);

clock.advance(4900);
reconnect();
gate.dispose();
clock.advance(5000);
state.refreshes
=> 0

clock.pendingCount()
=> 0
```
