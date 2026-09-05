/**
 * Startup + debounce + sweep wiring for the scan promote worker, in the same
 * shape as `bulk-upload-lifecycle.ts`: a startup pass that recovers whatever
 * the last process left mid-flight, a trigger the PUT route calls, and a slow
 * periodic sweep.
 *
 * The sweep exists because promote passes are otherwise driven only by
 * uploads: on a box that stops scanning, a rejection whose question was
 * answered would keep its bytes forever and an expired tombstone would never be
 * collected. It is deliberately slow — this is garbage collection, not latency.
 *
 * Registered per box by `registerScanUploadRoutes`. The state is per-box and
 * module-level because the trigger is called from a request handler that has
 * only a box root — the same reason the rate limiter keeps its buckets here.
 */

import type { FastifyInstance } from "fastify";
import { runScanPromotePass } from "../../core/scan/promote.js";
import { startAwakeTimeout, type AwakeTimeout } from "../../lib/awake-timeout.js";
import { createPromoteDebouncer, SCAN_SETTLE_MS, type PromoteDebouncer } from "../../core/scan/promote-debounce.js";

/** How much awake time between GC sweeps on an otherwise idle box. */
const SCAN_SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

const debouncers = new Map<string, PromoteDebouncer>();

/**
 * Run a pass and re-arm the settle window when it left work behind.
 *
 * A pass can end incomplete three ways — the promotion lock was held (another
 * process, or this box's startup pass, was mid-run), an upload failed, or the
 * wakeup failed. All three are retryable, and none of them re-trigger on their
 * own: the next PUT might be days away. Re-arming turns each into "try again
 * after another settle window" instead of "wait for the next scan".
 */
async function runPass(boxRoot: string): Promise<void> {
  const result = await runScanPromotePass({ boxRoot });
  const incomplete = result.skipped === "locked" || result.failed > 0 || result.wakeup === "failed";
  if (result.failed > 0) {
    console.warn(`[scan] Promote pass left ${result.failed} file(s) in promoting; retrying after the settle window`);
  }
  if (incomplete) debouncers.get(boxRoot)?.notify();
}

/**
 * Tell the worker a file just landed (accepted or rejected — a rejection needs
 * its question card). Starts or restarts the settle window; a no-op when the
 * box has no lifecycle wired, which is the case in unit tests that exercise the
 * routes without a server lifecycle.
 */
export function notifyScanUpload(boxRoot: string): void {
  debouncers.get(boxRoot)?.notify();
}

/** Self-rearming GC sweep on awake time; returns a cancel handle. */
function scheduleScanSweep(boxRoot: string): () => void {
  let timer: AwakeTimeout | null = null;
  let stopped = false;
  const arm = (): void => {
    if (stopped) return;
    timer = startAwakeTimeout({
      timeoutMs: SCAN_SWEEP_INTERVAL_MS,
      onTimeout: () => {
        void runPass(boxRoot)
          .catch((e: unknown) => console.error(`[scan] Promote sweep failed for box=${boxRoot}:`, e))
          .finally(() => arm());
      },
    });
  };
  arm();
  return () => {
    stopped = true;
    timer?.stop();
  };
}

/**
 * Wire the startup pass, the debounce trigger, and the GC sweep for a box, and
 * stop the timers when the server closes.
 */
export function startScanPromoteLifecycle(opts: { server: FastifyInstance; boxRoot: string }): void {
  const { server, boxRoot } = opts;
  const debouncer = createPromoteDebouncer({
    settleMs: SCAN_SETTLE_MS,
    run: () => runPass(boxRoot),
    label: boxRoot,
  });
  debouncers.set(boxRoot, debouncer);

  // Fire-and-forget so a cold box still serves immediately; the pass takes the
  // promotion lock, so it cannot collide with a PUT-triggered one.
  void runPass(boxRoot).catch((e: unknown) => {
    console.error("[scan] Startup promote pass failed:", e);
  });

  const cancelSweep = scheduleScanSweep(boxRoot);
  server.addHook("onClose", async () => {
    cancelSweep();
    debouncer.cancel();
    debouncers.delete(boxRoot);
  });
}
