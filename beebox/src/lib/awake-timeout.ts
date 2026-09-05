/**
 * Sleep-immune timeout: counts only time the machine spends awake toward
 * the deadline.
 *
 * A plain `setTimeout` cannot express "N minutes of running time" on
 * macOS: since libuv 1.45 (Node ≥ 20.3) the timer clock uses
 * `mach_continuous_time`, which advances during system sleep — so a
 * timer that comes due mid-sleep fires the instant the machine wakes.
 * (`performance.now()` counts sleep the same way, so wall-vs-monotonic
 * comparison can't detect sleep either.)
 *
 * Instead we tick a short interval and measure the gap between ticks.
 * Nothing fires while the machine sleeps, so a gap far larger than the
 * period means the run spanned a sleep; those gaps are excluded from the
 * accumulated awake time.
 */

export interface AwakeElapsed {
  /** Time accumulated while the machine was awake. */
  awakeMs: number;
  /** Wall-clock time since start, sleep included. */
  wallMs: number;
  /** True if any tick gap large enough to be sleep was observed. */
  sleepDetected: boolean;
}

export interface AwakeTimeoutOptions {
  /** Fire `onTimeout` once this much awake time has accumulated. */
  timeoutMs: number;
  onTimeout: (elapsed: AwakeElapsed) => void;
  /** Tick period. Defaults to 5s; tests pass something small. */
  periodMs?: number;
  /** A tick gap at or above this counts as sleep. Defaults to 6× period. */
  sleepGapMs?: number;
}

export interface AwakeTimeout {
  /** Snapshot of elapsed time. Frozen once stopped (except wallMs). */
  elapsed(): AwakeElapsed;
  /** Stop ticking. Idempotent; called automatically when the timeout fires. */
  stop(): void;
}

export function startAwakeTimeout(options: AwakeTimeoutOptions): AwakeTimeout {
  const periodMs = options.periodMs === undefined ? 5_000 : options.periodMs;
  const sleepGapMs =
    options.sleepGapMs === undefined ? periodMs * 6 : options.sleepGapMs;

  const startedAt = Date.now();
  let lastTick = startedAt;
  let awakeMs = 0;
  let sleepDetected = false;
  let stopped = false;

  /** Fold the time since the last tick into the totals. Sleep-sized gaps
   * (and clock-skew negatives) are recorded but not counted as awake. */
  const fold = (): void => {
    const now = Date.now();
    const gap = now - lastTick;
    lastTick = now;
    if (gap >= sleepGapMs) {
      sleepDetected = true;
      awakeMs += Math.min(gap, periodMs);
    } else if (gap > 0) {
      awakeMs += gap;
    }
  };

  const interval = setInterval(() => {
    fold();
    if (awakeMs >= options.timeoutMs) {
      stop();
      options.onTimeout(elapsed());
    }
  }, periodMs);

  function stop(): void {
    if (stopped) return;
    stopped = true;
    fold();
    clearInterval(interval);
  }

  function elapsed(): AwakeElapsed {
    if (!stopped) fold();
    return { awakeMs, wallMs: Date.now() - startedAt, sleepDetected };
  }

  return { elapsed, stop };
}
