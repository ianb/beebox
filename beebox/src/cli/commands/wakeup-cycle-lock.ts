/**
 * The per-box wakeup cycle lock.
 *
 * Nothing used to serialize whole cycles. Only the reactor step had a lock
 * (`core/reactor/engine.ts`), so `bbx tick`, the Sync button, and a scheduled
 * `bbx wakeup` could interleave preprocessing, connectors and push against each
 * other — two processes staging the same tree, pushing the same branch, and
 * each seeing half of the other's work. The reactor lock nests INSIDE this one;
 * nothing holding the reactor lock takes this one, so the order cannot deadlock.
 *
 * Contention does no work rather than waiting: a second cycle prints one line
 * and reports `skipped: "wakeup-running"` in its outcome, exiting 0. Waiting
 * would be worse — a queued cycle runs against a box the first cycle just
 * changed, which is the interleaving this removes, one step later.
 *
 * Consequence worth knowing: a full `bbx wakeup` runs the box's on-wakeup
 * scheduled scripts (step 3), and the seeded connector schedules run `bbx
 * wakeup --connector <name>`. Those children now skip instead of syncing
 * inside their parent's cycle. No sync is lost — the parent's own connector
 * step (4) runs every connector immediately afterwards — so what goes away is
 * a redundant second sync of the same service in the same cycle.
 */

import * as path from "node:path";
import { acquireLock, releaseLock, LockHeldError } from "../../lib/file-lock.js";
import { reportWakeupOutcome } from "./wakeup-outcome.js";

/** Printed by the cycle that found the lock held. One line, on purpose. */
export const WAKEUP_ALREADY_RUNNING = "Wakeup already running for this box; skipping.";

/** Gitignored, like the reactor's lock and the scheduler heartbeat. */
export function wakeupCycleLockPath(boxRoot: string): string {
  return path.join(boxRoot, ".beebox", "wakeup-cycle.lock");
}

/**
 * Run `runCycle` while holding the box's cycle lock, or skip entirely when
 * another cycle holds it. Returns whether the cycle ran.
 */
export async function runUnderWakeupCycleLock(
  boxRoot: string,
  runCycle: () => Promise<void>,
): Promise<boolean> {
  const lockPath = wakeupCycleLockPath(boxRoot);
  try {
    await acquireLock(lockPath, { purpose: "wakeup-cycle" });
  } catch (e) {
    if (!(e instanceof LockHeldError)) throw e;
    console.log(WAKEUP_ALREADY_RUNNING);
    // A skipped cycle did nothing, and must not read as a healthy one: a
    // supervisor waiting on a job would otherwise take "0 errors, reactor ok"
    // as an answer about work that never started.
    reportWakeupOutcome({
      connectorErrors: 0,
      connectors: [],
      reactorOk: true,
      reactorSkipped: false,
      jobsProcessed: 0,
      jobsRemaining: 0,
      skipped: "wakeup-running",
    });
    return false;
  }
  try {
    await runCycle();
  } finally {
    await releaseLock(lockPath);
  }
  return true;
}
