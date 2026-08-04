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
 */

export interface ReconnectRefreshGate {
  /**
   * Call on every (re)connect. Returns true — and records this instant as the
   * new baseline — if a REFRESH should fire now; false if it's within
   * `minIntervalMs` of the last one and should be skipped.
   */
  shouldRefresh: () => boolean;
}

export function createReconnectRefreshGate(opts: {
  minIntervalMs: number;
  /** The instant before which no REFRESH counts as "too soon" — usually mount time. */
  baselineAt: number;
  /** Injectable for tests; defaults to `Date.now`. */
  now?: () => number;
}): ReconnectRefreshGate {
  const now = opts.now ?? Date.now;
  let lastAt = opts.baselineAt;
  return {
    shouldRefresh: () => {
      const t = now();
      if (t - lastAt < opts.minIntervalMs) return false;
      lastAt = t;
      return true;
    },
  };
}
