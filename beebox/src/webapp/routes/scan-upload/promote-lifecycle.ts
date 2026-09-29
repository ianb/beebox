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
import { runScanPromotePass } from "../../../core/scan/promote/core.js";
import { withBoxWork, withoutBoxWork } from "../../../lib/box-maintenance.js";
import { BoxMaintenanceError } from "../../../lib/box-maintenance-error.js";
import { startAwakeTimeout, type AwakeTimeout } from "../../../shared/awake-timeout.js";
import { createPromoteDebouncer, SCAN_SETTLE_MS, type PromoteDebouncer } from "../../../core/scan/promote-debounce.js";

/** How much awake time between GC sweeps on an otherwise idle box. */
const SCAN_SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

const debouncers = new Map<string, PromoteDebouncer>();

/**
 * Consecutive incomplete passes allowed before this box stops re-arming
 * itself.
 *
 * The re-arm below is a self-trigger: an incomplete pass schedules another
 * pass, which can be incomplete again. Without a bound that is an infinite
 * loop, and each iteration is a full `bbx wakeup`. It is not hypothetical —
 * an expired connector credential ran exactly this loop in production, twelve
 * passes before a person noticed. Nothing retries forever.
 *
 * The wakeup half of this carries its own durable budget
 * (`core/scan/wakeup-retry.ts`), because a wakeup owed across a restart must
 * not get a fresh budget. This counter is the coarser in-process guard over
 * the other two reasons — a held lock and a failed upload — whose retries do
 * not survive a restart anyway.
 */
const MAX_CONSECUTIVE_INCOMPLETE_PASSES = 8;

/** Consecutive incomplete passes per box; cleared by any genuinely new work. */
const incompletePasses = new Map<string, number>();

/**
 * Run a pass and re-arm when it left work behind.
 *
 * A pass can end incomplete three ways — the promotion lock was held (another
 * process, or this box's startup pass, was mid-run), an upload failed, or the
 * wakeup failed. All three are retryable, and none of them re-trigger on their
 * own: the next PUT might be days away. Re-arming turns each into "try again
 * later" instead of "wait for the next scan" — bounded, so a failure that will
 * never clear stops instead of spinning.
 *
 * A held lock is deliberately NOT counted against the budget: it means another
 * pass is doing the work right now, which is the opposite of a stuck box.
 */
async function runPass(boxRoot: string): Promise<void> {
  const result = await runScanPromotePass({ boxRoot });

  if (result.failed > 0) {
    console.warn(`[scan] Promote pass left ${result.failed} file(s) in promoting; will retry`);
  }

  // The wakeup gave up under its own durable budget. Re-arming here would
  // restart the loop that budget exists to end.
  if (result.wakeup.kind === "abandoned") {
    incompletePasses.delete(boxRoot);
    return;
  }

  if (result.skipped === "locked") {
    debouncers.get(boxRoot)?.notify();
    return;
  }

  const incomplete = result.failed > 0 || result.wakeup.kind === "failed";
  if (!incomplete) {
    incompletePasses.delete(boxRoot);
    return;
  }

  // The wakeup's own backoff decides its delay; the other reasons use the
  // settle window, which is the pace new work arrives at anyway.
  rearmIncomplete(boxRoot, result.wakeup.kind === "failed" ? result.wakeup.retryDelayMs : undefined);
}

/** Count an incomplete pass against the budget and re-arm, at `delayMs` or the settle window. */
function rearmIncomplete(boxRoot: string, delayMs: number | undefined): void {
  const passes = (incompletePasses.get(boxRoot) ?? 0) + 1;
  incompletePasses.set(boxRoot, passes);
  if (passes >= MAX_CONSECUTIVE_INCOMPLETE_PASSES) {
    console.error(
      `[scan] Promote pass for box=${boxRoot} ended incomplete ${String(passes)} times in a row; ` +
        "no longer re-arming. The next upload, or a box restart, starts it again.",
    );
    return;
  }
  const debouncer = debouncers.get(boxRoot);
  if (delayMs === undefined) debouncer?.notify();
  else debouncer?.notifyAfter(delayMs);
}

/**
 * Run a pass as its own admitted box work.
 *
 * A pass is detached from whatever armed its timer, and that is usually an
 * upload request. Timers inherit async context, so without `withoutBoxWork`
 * the pass would carry the request's work permit after the request released
 * it. Every write under that permit, and every child it spawns (`bbx wakeup`,
 * the commit hook's `bbx validate`), then fails with "Work permission has
 * expired", on every retry, until the server restarts (2026-09-28). Taking a
 * fresh admission per pass also lets maintenance drain it like any other work.
 *
 * A closed box is an incomplete pass: it re-arms for when the box expects to
 * reopen and counts against the same budget.
 */
function admittedPass(boxRoot: string, pass: (boxRoot: string) => Promise<void>): Promise<void> {
  return withoutBoxWork(async () => {
    try {
      await withBoxWork({ boxRoot, reason: "scan promote" }, () => pass(boxRoot));
    } catch (error) {
      if (!(error instanceof BoxMaintenanceError && error.reason === "closed")) throw error;
      console.warn(`[scan] Promote pass for box=${boxRoot} deferred: ${error.message}`);
      rearmIncomplete(boxRoot, Math.max(SCAN_SETTLE_MS, error.retryAfterMs ?? 0));
    }
  });
}

/**
 * Tell the worker a file just landed (accepted or rejected — a rejection needs
 * its question card). Starts or restarts the settle window; a no-op when the
 * box has no lifecycle wired, which is the case in unit tests that exercise the
 * routes without a server lifecycle.
 */
export function notifyScanUpload(boxRoot: string): void {
  // A new file is new information: whatever was failing before, this is a
  // fresh reason to try. Mirrors `markWakeupPending` clearing the durable
  // wakeup budget.
  incompletePasses.delete(boxRoot);
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
        void admittedPass(boxRoot, runPass)
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
export function startScanPromoteLifecycle(opts: {
  server: FastifyInstance;
  boxRoot: string;
  /** Replaces the promote pass body in tests; admission still wraps it. */
  run?: (boxRoot: string) => Promise<void>;
}): void {
  const { server, boxRoot } = opts;
  const promote = opts.run ?? runPass;
  const executePass = (): Promise<void> => admittedPass(boxRoot, promote);
  let closing = false;
  const activePasses = new Set<Promise<void>>();
  const runTrackedPass = (): Promise<void> => {
    if (closing) return Promise.resolve();
    const pass = executePass();
    activePasses.add(pass);
    pass.then(
      () => activePasses.delete(pass),
      () => activePasses.delete(pass),
    );
    return pass;
  };
  const debouncer = createPromoteDebouncer({
    settleMs: SCAN_SETTLE_MS,
    run: runTrackedPass,
    label: boxRoot,
  });
  debouncers.set(boxRoot, debouncer);

  // Fire-and-forget so a cold box still serves immediately; the pass takes the
  // promotion lock, so it cannot collide with a PUT-triggered one.
  void runTrackedPass().catch((e: unknown) => {
    console.error("[scan] Startup promote pass failed:", e);
  });

  const cancelSweep = scheduleScanSweep(boxRoot);
  server.addHook("onClose", async () => {
    closing = true;
    cancelSweep();
    debouncer.cancel();
    debouncers.delete(boxRoot);
    incompletePasses.delete(boxRoot);
    await Promise.all(activePasses);
  });
}
