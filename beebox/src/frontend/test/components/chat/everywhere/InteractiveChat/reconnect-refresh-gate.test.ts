// # reconnect-refresh-gate — rate-gating reconnect-driven chat REFRESHes
//
// `createReconnectRefreshGate` (`components/chat/reconnect-refresh-gate.ts`)
// caps how often a WS reconnect is allowed to trigger a full chat history
// REFRESH: at most once per `minIntervalMs`, counted from a baseline (mount
// time) before the first real REFRESH. A flapping socket that reconnects
// faster than the window can't produce a REFRESH per flap — only the earlier
// first-connect-vs-mount-time check did that; this applies the same window to
// every later reconnect too.
//
// A reconnect suppressed inside the window is not dropped: it arms a trailing
// timer for the window's end, so the socket's last word is always eventually
// serviced.

import { test } from "tap";
import "agent-doctest/tap";
import { createReconnectRefreshGate } from "../../../../../src/components/chat/everywhere/InteractiveChat/reconnect-refresh-gate.js";

type Handle = ReturnType<typeof globalThis.setTimeout>;
// A timer handle that is unique and never fires: a real one, cancelled at once.
function newHandle(): Handle {
  const handle = globalThis.setTimeout(() => {}, 0);
  globalThis.clearTimeout(handle);
  return handle;
}

// A fake clock + timer scheduler so trailing-timer behavior is testable
// without real wall-clock waits. `advance` moves the clock and fires any
// timer whose deadline has been reached, in deadline order.
function fakeClock(startAt: number) {
  let t = startAt;
  const timers: Array<{ id: Handle; dueAt: number; fn: () => void }> = [];
  return {
    now: () => t,
    setTimeout: (fn: () => void, delayMs: number) => {
      const id = newHandle();
      timers.push({ id, dueAt: t + delayMs, fn });
      return id;
    },
    clearTimeout: (id: Handle) => {
      const idx = timers.findIndex((tm) => tm.id === id);
      if (idx !== -1) timers.splice(idx, 1);
    },
    advance: (ms: number) => {
      t += ms;
      const due = timers.filter((tm) => tm.dueAt <= t).toSorted((a, b) => a.dueAt - b.dueAt);
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

// ## A connect within the window of the baseline is suppressed (but scheduled)
//
// Mirrors the original "first connect shortly after mount" case: mount's own
// bootstrap already loaded history, so an immediate reconnect is redundant —
// but it's not lost, it just waits for the rest of the window.
void test("Mirrors the original \"first connect shortly after mount\" case:", async (t) => {
  // doctest:L75
  const { clock, state, reconnect } = makeGate(1_000);

  // doctest:L77
  clock.advance(1000);
  reconnect();
  t.check(state.refreshes, 0);

  // ## A connect past the window fires immediately, and becomes the new baseline

  // doctest:L86
  clock.advance(4500);
  reconnect();
  t.check(state.refreshes, 1);

  // ## Every later reconnect is gated too, not just the first
  //
  // A flapping socket reconnecting 200ms after the last REFRESH is suppressed —
  // this is the bug fix: the old code only checked elapsed-since-mount once, so
  // every reconnect after the first sent an unconditional REFRESH.

  // doctest:L99
  clock.advance(200);
  reconnect();
  clock.advance(200);
  reconnect();
  t.check(state.refreshes, 1);

  // Once enough time has passed since the last actual REFRESH (not since mount),
  // it fires again:

  // doctest:L111
  clock.advance(5000);
  reconnect();
  t.check(state.refreshes, 2);
});

// ## A connect exactly at the boundary is not yet due
//
// `minIntervalMs` is a floor — exactly at the boundary hasn't cleared it (the
// next tick will).
void test("minIntervalMs is a floor — exactly at the boundary hasn't cleared it (the nex...", async (t) => {
  // doctest:L123
  const { clock, state, reconnect } = makeGate(0);

  // doctest:L125
  clock.advance(5000);
  reconnect();
  t.check(state.refreshes, 1);

  // doctest:L130
  clock.advance(4999);
  reconnect();
  t.check(state.refreshes, 1);
});

// ## Reconnect at t=4.9s then a stable connection: the refresh still fires once, at ~t=5s
//
// The scenario that used to lose history for good: an outage exceeds event-bus
// retention, the socket reconnects near the end of the window, and then stays
// up — no further reconnect ever arrives to "get lucky" past the gate. The
// trailing timer is what still services it. The connection stays stable — no
// further `notifyReconnect` call — but the armed timer still fires once the
// window elapses:
void test("The scenario that used to lose history for good:", async (t) => {
  // doctest:L146
  const { clock, state, reconnect } = makeGate(0);

  // doctest:L148
  clock.advance(4900);
  reconnect();
  t.check(state.refreshes, 0);

  // doctest:L153
  clock.advance(99);
  t.check(state.refreshes, 0);

  // doctest:L157
  clock.advance(1);
  t.check(state.refreshes, 1);
});

// Further reconnects that land before the timer fires coalesce into the same
// single pending timer rather than each pushing the deadline back out. Advancing
// to the ORIGINAL deadline (not pushed out by the second reconnect) fires it:
void test("Further reconnects that land before the timer fires coalesce into the same si...", async (t) => {
  // doctest:L167
  const { clock, state, reconnect } = makeGate(0);

  // doctest:L169
  clock.advance(4900);
  reconnect();
  clock.advance(50);
  // Still suppressed; coalesces into the already-pending timer rather than re-arming it.
  reconnect();
  t.check(clock.pendingCount(), 1);

  // doctest:L177
  clock.advance(50);
  t.check(state.refreshes, 1);
});

// ## `dispose` cancels the pending trailing refresh
//
// Unmount (or a session switch remounting the hook) must not let a stale timer
// fire into a torn-down closure.
void test("Unmount (or a session switch remounting the hook) must not let a stale timer...", async (t) => {
  // doctest:L188
  const { clock, gate, state, reconnect } = makeGate(0);

  // doctest:L190
  clock.advance(4900);
  reconnect();
  gate.dispose();
  clock.advance(5000);
  t.check(state.refreshes, 0);

  // doctest:L197
  t.check(clock.pendingCount(), 0);
});
