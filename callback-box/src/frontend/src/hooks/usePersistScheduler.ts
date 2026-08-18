/**
 * Shared debounce + flush-on-hide lifecycle for the draft-persistence hooks
 * (`useDictationDraft`, `useEmissionPersistence`). Both want the same shape:
 * debounce writes while the user is active, and flush synchronously when the
 * tab is about to be suspended (screen lock / app switch — the moment a
 * session is most likely to drop) so the debounce gap can't lose the last
 * edit. What differs between the two callers — the value being written, the
 * storage key, and the guard on whether a flush should actually happen right
 * now (e.g. "only while transcribing", "not mid-restore") — stays with each
 * caller; this controller only owns the timer and the visibility subscription.
 *
 * On unmount the pending write is FLUSHED, not dropped. A tab-hide is only one
 * of the two ways a scheduled write can lose its window: an in-app navigation
 * (a route change, a session switch) unmounts the hook with the tab still
 * visible, and canceling the pending write there is how a send's
 * persisted-draft clear went missing and resurfaced as an "unsent" recovery
 * draft (issues/bugs/2026-07-23-voice-send-lingers-as-unsent-recovery-draft.md).
 * The debounce machine itself is `lib/persist-scheduler.ts` — pure, timers
 * injected, doctested.
 */

import { useCallback, useEffect, useRef } from "react";
import { createPersistScheduler, browserTimers, type PersistSchedulerCore } from "../lib/persist-scheduler";

/** The shared debounce delay for continuous draft persistence. */
export const PERSIST_DEBOUNCE_MS = 400;

export interface PersistScheduler {
  /** Debounce-schedule `write`, canceling any previously-scheduled write first. */
  schedule: (write: () => void) => void;
  /** Cancel a pending scheduled write without running it. */
  cancel: () => void;
  /**
   * Run the pending scheduled write now (no-op when nothing is pending). For
   * caller cleanups that re-run on a dependency change — a box switch swaps
   * the store/key mid-session without unmounting, so only the caller, whose
   * old closure still writes under the old key, can flush that boundary.
   */
  flush: () => void;
}

/**
 * Returns a `{ schedule, cancel }` pair backed by a single timer, and wires
 * `onHide` to fire whenever the tab becomes hidden (the caller decides what
 * "flush" means — typically canceling the pending write and persisting the
 * current value synchronously). `onHide` receives this same `cancel` so a
 * caller can cancel-then-flush without closing over the controller's own
 * return value (which would create a definition-order cycle).
 *
 * `debounceMs` is read once, when the controller is created — both callers
 * pass the module constant, and a live delay change has no meaning here.
 */
export function usePersistScheduler(opts: {
  debounceMs: number;
  onHide: (cancel: () => void) => void;
}): PersistScheduler {
  const { debounceMs, onHide } = opts;
  // One controller per mount, created on first use. It lives in a ref and is
  // only ever touched from callbacks and effects — never during render.
  const coreRef = useRef<PersistSchedulerCore | null>(null);
  const getCore = useCallback((): PersistSchedulerCore => {
    const existing = coreRef.current;
    if (existing !== null) return existing;
    const created = createPersistScheduler({ debounceMs, timers: browserTimers });
    coreRef.current = created;
    return created;
  }, [debounceMs]);

  const cancel = useCallback(() => {
    getCore().cancel();
  }, [getCore]);

  const schedule = useCallback(
    (write: () => void) => {
      getCore().schedule(write);
    },
    [getCore],
  );

  const flush = useCallback(() => {
    getCore().flush();
  }, [getCore]);

  useEffect(() => {
    function handleVisibilityChange(): void {
      if (document.visibilityState === "hidden") onHide(cancel);
    }
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [onHide, cancel]);

  // Deliberately its own, dependency-free effect: `onHide` changes on every
  // keystroke/transcript tick for some callers, so sharing the effect above
  // would flush on each of those re-subscriptions instead of on unmount —
  // which is to say, no debounce at all. It also has to be registered here,
  // inside this hook, so React tears it down BEFORE the caller's own effects
  // (destroy runs in creation order) — a caller cleanup that calls `cancel`
  // would otherwise empty the queue before this ever saw it.
  useEffect(() => {
    return () => {
      coreRef.current?.flush();
    };
  }, []);

  return { schedule, cancel, flush };
}
