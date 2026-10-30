/**
 * Refetch a view's data when the box changes.
 *
 * A bus event that `when` accepts, and every reconnect after the first (the
 * socket may have dropped `file-change` events, which are not replayed),
 * request a `refresh` through `useDeferredResync`: same-tick requests collapse
 * into one, and a request while the tab is hidden waits until it is shown. The
 * first connect does not refresh; the caller's query already loads on mount.
 *
 * With `burstMs`, the first matching event starts one timer and later events
 * inside the window are ignored; the refresh is requested when it ends.
 *
 * Matchers for `when` are in `lib/live-refresh.ts`. Caches that must stay
 * current while the tab is hidden (`lib/view-bindings.ts`) do not use this.
 */

import { useCallback, useEffect, useRef } from "react";
import { useBusSubscription, type RealtimeEvent } from "./useBusSubscription";
import { useDeferredResync } from "./useDeferredResync";

export interface UseLiveRefreshOptions {
  /** Which bus events call for a refresh. */
  when: (event: RealtimeEvent) => boolean;
  refresh: () => void;
  /** Collapse a burst: refresh once, this long after the first event. Default 0. */
  burstMs?: number;
}

export function useLiveRefresh(opts: UseLiveRefreshOptions): { connected: boolean } {
  const optsRef = useRef(opts);
  useEffect(() => {
    optsRef.current = opts;
  });

  const trigger = useDeferredResync(useCallback(() => {
    optsRef.current.refresh();
  }, []));

  const burstTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (burstTimer.current !== null) clearTimeout(burstTimer.current);
    burstTimer.current = null;
  }, []);

  return useBusSubscription({
    onEvent: useCallback((event: RealtimeEvent) => {
      const { when, burstMs = 0 } = optsRef.current;
      if (!when(event)) return;
      if (burstMs <= 0) {
        trigger();
        return;
      }
      if (burstTimer.current !== null) return;
      burstTimer.current = setTimeout(() => {
        burstTimer.current = null;
        trigger();
      }, burstMs);
    }, [trigger]),
    onReconnect: trigger,
  });
}
