// # Persist scheduler — debounce, supersede, flush
//
// The debounce state machine behind `usePersistScheduler` (draft persistence
// for the composer emission and the dictation transcript). Timers are
// injected, so the whole schedule/supersede/flush/cancel contract is testable
// without React or a browser.
//
// The rule that earns this file: a **flush runs the LATEST scheduled write and
// only that one**. The hook flushes on unmount as well as on tab-hide — an
// in-app navigation unmounts with the tab still visible, and a canceled write
// there was how a send's persisted-draft clear went missing
// (issues/bugs/2026-07-23-voice-send-lingers-as-unsent-recovery-draft.md).

import { test } from "tap";
import "agent-doctest/tap";
import { createPersistScheduler, type SchedulerTimers } from "../../src/lib/persist-scheduler.js";

/** A hand-cranked clock: `tick(ms)` fires whatever is due. */
function fakeTimers(): SchedulerTimers & { tick(ms: number): void; count(): number } {
  const timers = new Map<number, { due: number; fn: () => void }>();
  let now = 0;
  let nextId = 1;
  return {
    setTimeout(fn, ms) {
      const id = nextId++;
      timers.set(id, { due: now + ms, fn });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    tick(ms) {
      now += ms;
      for (const [id, timer] of [...timers]) {
        if (timer.due <= now) {
          timers.delete(id);
          timer.fn();
        }
      }
    },
    count: () => timers.size,
  };
}

// ## A debounced write fires once, after the delay
void test("A debounced write fires once, after the delay", async (t) => {
  // doctest:L48
  const timers = fakeTimers();
  const s = createPersistScheduler({ debounceMs: 400, timers });
  const written: string[] = [];

  // doctest:L52
  s.schedule(() => written.push("a"));
  timers.tick(399);
  await t.checkText(written.length, "0");

  // doctest:L57
  timers.tick(1);
  t.check(written.join(","), "a");

  // doctest:L61
  // The timer is spent — later ticks add nothing.
  timers.tick(1000);
  t.check(written.join(",") + " | pending timers: " + timers.count(), "a | pending timers: 0");
});

// ## A newer scheduled write supersedes an older un-fired one
//
// Typing schedules a write per keystroke; only the last one should reach
// storage, and it should reach it 400ms after the LAST keystroke.
void test("Typing schedules a write per keystroke; only the last one should reach storag...", async (t) => {
  // doctest:L73
  const timers = fakeTimers();
  const s = createPersistScheduler({ debounceMs: 400, timers });
  const written: string[] = [];

  // doctest:L77
  s.schedule(() => written.push("hel"));
  timers.tick(300);
  s.schedule(() => written.push("hell"));
  timers.tick(300);
  s.schedule(() => written.push("hello"));

  // doctest:L83
  t.check(
    // Still nothing: each keystroke restarted the window.
    written.length + " written | pending timers: " + timers.count(),
    "0 written | pending timers: 1",
  );

  // doctest:L87
  timers.tick(400);
  t.check(written.join(","), "hello");
});

// ## Flush on unmount runs the latest pending write — and only that one
void test("Flush on unmount runs the latest pending write — and only that one", async (t) => {
  // doctest:L95
  const timers = fakeTimers();
  const s = createPersistScheduler({ debounceMs: 400, timers });
  const written: string[] = [];

  // doctest:L99
  s.schedule(() => written.push("stale"));
  s.schedule(() => written.push("latest"));
  s.flush();
  t.check(written.join(","), "latest");

  // doctest:L105
  // Flushing consumed the pending write: the abandoned timer can't replay it,
  // and a second flush is a no-op.
  timers.tick(1000);
  s.flush();
  t.check(written.join(","), "latest");
});

// A flush with nothing pending does nothing at all — the common unmount.
void test("A flush with nothing pending does nothing at all — the common unmount.", async (t) => {
  // doctest:L116
  const timers = fakeTimers();
  const s = createPersistScheduler({ debounceMs: 400, timers });
  let calls = 0;

  // doctest:L120
  s.flush();
  s.schedule(() => { calls++; });
  timers.tick(400);
  s.flush();
  t.check(calls, 1);
});

// ## Cancel drops the pending write; the hidden-flush is cancel-then-write
//
// `onHide` receives `cancel` and does its own synchronous write — the pattern
// both callers use, so the pending debounced write can't fire again afterwards
// with staler state.
void test("onHide receives cancel and does its own synchronous write — the pattern both...", async (t) => {
  // doctest:L135
  const timers = fakeTimers();
  const s = createPersistScheduler({ debounceMs: 400, timers });
  const written: string[] = [];

  // doctest:L139
  s.schedule(() => written.push("debounced"));
  s.cancel();
  timers.tick(1000);
  await t.checkText(written.length, "0");

  // doctest:L145
  // The tab-hide path: cancel, then persist the current value now.
  s.schedule(() => written.push("debounced-2"));
  s.cancel();
  written.push("hidden-flush");
  timers.tick(1000);
  t.check(written.join(","), "hidden-flush");
});
