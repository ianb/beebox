/**
 * Screen wake-lock hook. Imperative request/release API, with an
 * always-mounted visibility-change handler that re-acquires the lock
 * if the browser dropped it while the tab was hidden.
 *
 * Patterned after memory-atlas/components/wakelock.ts.
 *
 * Usage:
 *   const { requestWakeLock, releaseWakeLock } = useWakeLock();
 *   // ... when starting recording / a long action:
 *   await requestWakeLock();
 *   // ... when done:
 *   await releaseWakeLock();
 */

import { useCallback, useEffect, useRef } from "react";

export interface WakeLockApi {
  /** Request a screen wake lock. Idempotent — returns true if already held. */
  requestWakeLock: () => Promise<boolean>;
  /** Release the wake lock if held. Returns true if it was held and is now released. */
  releaseWakeLock: () => Promise<boolean>;
}

export function useWakeLock(): WakeLockApi {
  const wakeLock = useRef<WakeLockSentinel | null>(null);

  const requestWakeLock = useCallback(async (): Promise<boolean> => {
    if (wakeLock.current !== null && !wakeLock.current.released) {
      return true;
    }
    if (typeof navigator === "undefined" || navigator.wakeLock === undefined) {
      console.warn("[wakelock] navigator.wakeLock is not available in this browser");
      return false;
    }
    try {
      wakeLock.current = await navigator.wakeLock.request("screen");
      console.info("[wakelock] acquired");
      // The browser may release the lock asynchronously (e.g. on tab hide).
      // Logging the event helps diagnose drops; the visibility handler
      // below re-acquires when the tab becomes visible again.
      wakeLock.current.addEventListener("release", () => {
        console.info("[wakelock] released by browser");
      });
      return true;
    } catch (e) {
      console.warn(`[wakelock] request failed: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    }
  }, []);

  const releaseWakeLock = useCallback(async (): Promise<boolean> => {
    if (wakeLock.current === null) return false;
    const sentinel = wakeLock.current;
    wakeLock.current = null;
    try {
      await sentinel.release();
      console.info("[wakelock] released by app");
      return true;
    } catch (e) {
      console.warn(`[wakelock] release failed: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    }
  }, []);

  // Re-acquire when the tab becomes visible if we had a lock that the
  // browser dropped on hide. Always mounted so a release-on-hide while
  // the consumer isn't actively requesting still gets recovered.
  useEffect(() => {
    function onVisibilityChange(): void {
      if (document.visibilityState !== "visible") return;
      if (wakeLock.current === null) return;
      if (!wakeLock.current.released) return;
      console.info("[wakelock] re-acquiring after visibility change");
      void requestWakeLock();
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [requestWakeLock]);

  return { requestWakeLock, releaseWakeLock };
}
