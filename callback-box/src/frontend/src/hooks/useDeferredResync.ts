/**
 * React binding for `lib/deferred-resync.ts`'s `createDeferredResync`.
 *
 * Handles the two things a raw `createDeferredResync` call gets wrong inside
 * a component: the underlying `visibilitychange` listener must attach in an
 * effect (not during render — `createDeferredResync` is a side effect) and
 * detach on unmount, and the `fn` it eventually calls must always be the
 * latest render's closure, not whatever was current when the instance was
 * built (the same stale-closure trap `useBusSubscription`'s `optionsRef`
 * exists for).
 */

import { useCallback, useEffect, useRef } from "react";
import { createDeferredResync, type VisibilityAdapter } from "../lib/deferred-resync";

export interface UseDeferredResyncOptions {
  /** See `CreateDeferredResyncOptions.alwaysVisible`. Default false. */
  alwaysVisible?: boolean;
  /** Injectable for tests; defaults to the real `document`. */
  visibility?: VisibilityAdapter;
}

/**
 * Returns a stable `trigger` callback. Calling it requests an invocation of
 * `fn` (always the latest one passed in), collapsed same-tick and deferred
 * while the tab is hidden per `createDeferredResync`'s contract.
 */
export function useDeferredResync(fn: () => void, opts?: UseDeferredResyncOptions): () => void {
  const fnRef = useRef(fn);
  useEffect(() => {
    fnRef.current = fn;
  }, [fn]);

  const alwaysVisible = opts?.alwaysVisible;
  const visibility = opts?.visibility;
  const resyncRef = useRef<ReturnType<typeof createDeferredResync> | null>(null);
  useEffect(() => {
    const resync = createDeferredResync(() => {
      fnRef.current();
    }, { alwaysVisible, visibility });
    resyncRef.current = resync;
    return () => {
      resync.dispose();
      resyncRef.current = null;
    };
  }, [alwaysVisible, visibility]);

  return useCallback(() => {
    resyncRef.current?.trigger();
  }, []);
}
