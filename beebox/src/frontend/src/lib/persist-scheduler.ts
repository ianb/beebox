/**
 * The debounce state machine behind `hooks/usePersistScheduler` — pure, with
 * timers injected, so its schedule/supersede/flush/cancel semantics are
 * doctestable without React or a browser (test/frontend/persist-scheduler.doctest.md).
 *
 * The one rule that isn't obvious: a `flush()` runs the LATEST scheduled
 * write and only that one. Each `schedule()` supersedes the previous pending
 * write outright (the writes are whole-value snapshots, not increments), so
 * replaying an older one would persist a stale draft over a newer one — the
 * failure mode the unmount flush would otherwise introduce.
 */

/** The timer surface this needs — `window` in the app, a fake list in doctests. */
export interface SchedulerTimers {
  setTimeout(fn: () => void, ms: number): number;
  clearTimeout(id: number): void;
}

export interface PersistSchedulerCore {
  /** Debounce-schedule `write`, superseding any previously-scheduled write. */
  schedule(write: () => void): void;
  /** Drop the pending write without running it. */
  cancel(): void;
  /** Run the pending write NOW (the latest one only), if there is one. */
  flush(): void;
}

export function createPersistScheduler(opts: { debounceMs: number; timers: SchedulerTimers }): PersistSchedulerCore {
  const { debounceMs, timers } = opts;
  let timerId: number | null = null;
  let pending: (() => void) | null = null;

  function clearPending(): void {
    if (timerId !== null) {
      timers.clearTimeout(timerId);
      timerId = null;
    }
    pending = null;
  }

  return {
    schedule(write) {
      clearPending();
      pending = write;
      timerId = timers.setTimeout(() => {
        timerId = null;
        const run = pending;
        pending = null;
        if (run !== null) run();
      }, debounceMs);
    },
    cancel: clearPending,
    flush() {
      const run = pending;
      clearPending();
      if (run !== null) run();
    },
  };
}

/** The real browser timers, bound so `this` isn't lost off `window`. */
export const browserTimers: SchedulerTimers = {
  setTimeout: (fn, ms) => window.setTimeout(fn, ms),
  clearTimeout: (id) => {
    window.clearTimeout(id);
  },
};
