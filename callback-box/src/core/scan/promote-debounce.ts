/**
 * Batch-settle debouncer for the scan promote worker.
 *
 * A scan session arrives as a burst of PUTs. Promoting each one as it lands
 * would turn a ten-document session into ten scan-import runs and ten wakeups,
 * so the worker instead waits for the burst to end: every PUT re-arms a timer,
 * and the pass runs once no new file has arrived for the settle window.
 *
 * The timer counts AWAKE time (`startAwakeTimeout`): a plain `setTimeout`'s
 * clock advances while a laptop sleeps, so a lid closed mid-session would fire
 * the promote the instant the machine woke, mid-burst.
 */

import { startAwakeTimeout, type AwakeTimeout } from "../../lib/awake-timeout.js";

/** Production settle window: no new PUT for two minutes ends the batch. */
export const SCAN_SETTLE_MS = 2 * 60 * 1000;

export interface PromoteDebouncer {
  /** Called on every accepted upload; (re)starts the settle window. */
  notify(): void;
  /** Cancel a pending run (server close). Idempotent. */
  cancel(): void;
}

/**
 * Build a debouncer around `run`. `run`'s rejections are logged, never thrown
 * at the timer — and a re-notify while a pass is running arms a fresh window,
 * so a file that lands mid-pass still gets promoted.
 */
export function createPromoteDebouncer(opts: {
  settleMs: number;
  run: () => Promise<void>;
  label: string;
}): PromoteDebouncer {
  const { settleMs, run, label } = opts;
  let timer: AwakeTimeout | null = null;
  let cancelled = false;

  return {
    notify() {
      if (cancelled) return;
      timer?.stop();
      timer = startAwakeTimeout({
        timeoutMs: settleMs,
        // The tick has to be finer than the window, or a two-minute window
        // measured in five-second ticks would never observe a shorter one.
        periodMs: Math.max(50, Math.min(5_000, Math.floor(settleMs / 4))),
        onTimeout: () => {
          timer = null;
          void run().catch((e: unknown) => {
            console.error(`[scan] Promote pass for ${label} failed:`, e);
          });
        },
      });
    },
    cancel() {
      cancelled = true;
      timer?.stop();
      timer = null;
    },
  };
}
