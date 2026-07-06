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
 */

import { useCallback, useEffect, useRef } from "react";

/** The shared debounce delay for continuous draft persistence. */
export const PERSIST_DEBOUNCE_MS = 400;

export interface PersistScheduler {
  /** Debounce-schedule `write`, canceling any previously-scheduled write first. */
  schedule: (write: () => void) => void;
  /** Cancel a pending scheduled write without running it. */
  cancel: () => void;
}

/**
 * Returns a `{ schedule, cancel }` pair backed by a single timer, and wires
 * `onHide` to fire whenever the tab becomes hidden (the caller decides what
 * "flush" means — typically canceling the pending write and persisting the
 * current value synchronously). `onHide` receives this same `cancel` so a
 * caller can cancel-then-flush without closing over the controller's own
 * return value (which would create a definition-order cycle).
 */
export function usePersistScheduler(opts: {
  debounceMs: number;
  onHide: (cancel: () => void) => void;
}): PersistScheduler {
  const { debounceMs, onHide } = opts;
  const timerRef = useRef<number | null>(null);

  const cancel = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const schedule = useCallback(
    (write: () => void) => {
      cancel();
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        write();
      }, debounceMs);
    },
    [cancel, debounceMs],
  );

  useEffect(() => {
    function handleVisibilityChange(): void {
      if (document.visibilityState === "hidden") onHide(cancel);
    }
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [onHide, cancel]);

  return { schedule, cancel };
}
