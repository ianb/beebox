/**
 * Warm a react-query cache entry in the browser's idle time.
 *
 * The pattern this exists to make safe: a menu or panel whose data is too
 * expensive to load on every page mount, but which then shows "Loading…" the
 * first time the user opens it. Leaving the query lazy is right; making the
 * user wait for it is not. So the page fetches it *after* it is itself
 * interactive, off the critical path — the query keeps its `enabled` gate and
 * simply finds the cache already warm.
 *
 * Two rules keep this from becoming the eager load it replaces:
 *  - It runs from `requestIdleCallback`, so it competes with nothing the user
 *    is waiting on. (`setTimeout` fallback for Safari before 17.4.)
 *  - It is gated on `enabled`, which callers set from their own mount-time
 *    query having settled — the prefetch must never be something the page's
 *    readiness gate can wait on, or it is back on the critical path.
 *
 * Fires once per mount. A prefetch is a warm-up, not a refresh: keeping a
 * cache entry current is `invalidate()`'s job at the point of use.
 *
 * **It is visible to `data-cb-loading`.** That attribute (see
 * `lib/trpc/provider.tsx`) reflects "any react-query fetch is in flight", so a
 * prefetch keeps it `true` a little past the point where the page is usable,
 * and headless automation that waits on it waits for the warm-up too. Left as
 * is on purpose: the flag's contract is *is the app still fetching*, and it is
 * — a prefetch that raced ahead of the readiness signal would be a lie in the
 * other direction. Keep prefetches cheap and this stays a non-issue.
 */

import { useEffect, useRef } from "react";

/** How long to wait for a genuine idle moment before running anyway. */
const IDLE_DEADLINE_MS = 2000;

/** `requestIdleCallback` where it exists, a timeout where it doesn't. */
function scheduleIdle(run: () => void): () => void {
  if (typeof requestIdleCallback === "function") {
    const handle = requestIdleCallback(run, { timeout: IDLE_DEADLINE_MS });
    return () => cancelIdleCallback(handle);
  }
  const handle = setTimeout(run, IDLE_DEADLINE_MS);
  return () => clearTimeout(handle);
}

/**
 * Run `prefetch` once, in idle time, after `enabled` first turns true.
 *
 * `prefetch` is read through a ref, so callers can pass an inline closure
 * (`() => utils.chat.byLandmark.prefetch()`) without re-arming anything.
 * A rejection is logged rather than thrown: failing to warm a cache is not a
 * user-visible failure, but a prefetch that always fails is worth seeing.
 */
export function useIdlePrefetch(prefetch: () => Promise<unknown>, opts: { enabled: boolean }): void {
  const { enabled } = opts;
  const latest = useRef(prefetch);
  const fired = useRef(false);
  useEffect(() => {
    latest.current = prefetch;
  });

  useEffect(() => {
    if (!enabled || fired.current) return;
    return scheduleIdle(() => {
      fired.current = true;
      latest.current().catch((e: unknown) => {
        console.warn("[prefetch] warming a query failed:", e);
      });
    });
  }, [enabled]);
}
