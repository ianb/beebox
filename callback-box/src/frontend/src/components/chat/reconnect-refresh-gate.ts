/**
 * Rate-gate for reconnect-driven chat REFRESHes.
 *
 * Every WS (re)connect triggers a full history REFRESH (`InteractiveChat-ws.ts`)
 * as a belt over the subscription's automatic replay, for gaps that exceed the
 * event-bus retention window. XState's invoke-cancellation makes stacked
 * REFRESHes safe (a second REFRESH before the first resolves just supersedes
 * it), but a flapping socket still produces one full history round-trip per
 * flap — no cap on how often that can happen. This gate imposes one: a
 * REFRESH may fire only if at least `minIntervalMs` has elapsed since the
 * last one (or since a caller-supplied baseline, e.g. mount time, before the
 * first).
 *
 * The mount-time baseline is what let the *first* connect double as "this
 * mount just established the subscription, its own bootstrap already loaded
 * history" — a REFRESH within `minIntervalMs` of mount is redundant. Folding
 * that into the same gate (rather than a separate first-connect special case)
 * is what makes every later reconnect respect the same window, not just the
 * first.
 *
 * **Trailing edge.** A reconnect suppressed inside the window is not simply
 * dropped: it arms a single trailing timer for the window's end (measured
 * from the current baseline, not from the suppressed reconnect's own
 * instant), so the socket's last word is always eventually serviced even if
 * no further reconnect ever arrives to trigger it. A flurry of reconnects
 * inside the same window coalesces onto that one timer rather than each
 * pushing the deadline back out. Without this, a reconnect landing just
 * inside the window (e.g. an outage that exceeds event-bus retention,
 * reconnecting at t=4.9s of a 5s window) could be the *last* reconnect the
 * socket ever makes — stable after that — and the missed history would stay
 * missing until an unrelated event or a manual reload.
 */

export interface ReconnectRefreshGate {
  /**
   * Call on every (re)connect. If at least `minIntervalMs` has elapsed since
   * the last REFRESH (or the baseline, before the first), invokes
   * `onRefresh` synchronously now and records this instant as the new
   * baseline. Otherwise the reconnect is suppressed but not lost: a single
   * trailing timer is (re)armed — or left alone if one is already pending —
   * to invoke `onRefresh` once the window elapses.
   */
  notifyReconnect: (onRefresh: () => void) => void;
  /** Cancel any pending trailing timer. Call on unmount/dispose. */
  dispose: () => void;
}

export function createReconnectRefreshGate(opts: {
  minIntervalMs: number;
  /** The instant before which no REFRESH counts as "too soon" — usually mount time. */
  baselineAt: number;
  /** Injectable for tests; defaults to `Date.now`. */
  now?: () => number;
  /** Injectable for tests; defaults to the real `setTimeout`. */
  setTimeout?: (fn: () => void, delayMs: number) => ReturnType<typeof globalThis.setTimeout>;
  /** Injectable for tests; defaults to the real `clearTimeout`. */
  clearTimeout?: (handle: ReturnType<typeof globalThis.setTimeout>) => void;
}): ReconnectRefreshGate {
  const now = opts.now ?? Date.now;
  const scheduleTimeout = opts.setTimeout ?? globalThis.setTimeout;
  const cancelTimeout = opts.clearTimeout ?? globalThis.clearTimeout;
  let lastAt = opts.baselineAt;
  let pendingTimer: ReturnType<typeof globalThis.setTimeout> | null = null;

  function cancelPending(): void {
    if (pendingTimer !== null) {
      cancelTimeout(pendingTimer);
      pendingTimer = null;
    }
  }

  return {
    notifyReconnect: (onRefresh) => {
      const t = now();
      if (t - lastAt >= opts.minIntervalMs) {
        cancelPending();
        lastAt = t;
        onRefresh();
        return;
      }
      if (pendingTimer !== null) return; // already coalescing into the pending trailing fire
      const delay = opts.minIntervalMs - (t - lastAt);
      pendingTimer = scheduleTimeout(() => {
        pendingTimer = null;
        lastAt = now();
        onRefresh();
      }, delay);
    },
    dispose: cancelPending,
  };
}
