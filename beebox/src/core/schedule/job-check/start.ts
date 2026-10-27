/**
 * Starting the job check's wakeup, and recording how it ended.
 *
 * The scheduler pass starts one full wakeup when an unscoped job is waiting
 * (`./core.ts`). The run must outlive the pass: on a unit host the pass is a
 * oneshot unit whose cgroup ends with it, so the box server starts the run
 * (`wakeup.start`); elsewhere the daemon's own long-lived process does. Both
 * come here. See docs/plans/on-demand-job-triggers.md, Track C.
 */

import { withBoxWork, withoutBoxWork } from "../../../lib/box-maintenance/admission.js";
import { errorMessage } from "../../../shared/error-guards.js";
import { runBbxWakeup, startBbxWakeup, type WakeupStart } from "../../commands/wakeup.js";
import type { WakeupRunner, WakeupRunResult } from "../../wakeup-runner.js";
import { writeBoxLog } from "../box-log.js";

/** Reactor cycles a job-check run asks for: the reactor's own default. */
export const TRIGGER_MAX_CYCLES = 3;

/** The answer a starter gives the pass. */
export type JobCheckStart = Pick<WakeupStart, "state" | "detail">;

/** Boxes with a job-check run in flight from this process. */
const inFlight = new Set<string>();

/**
 * Write the `job-check run ended` line when `done` settles: `ok`, the
 * outcome's counts, and the detail of a failed run or the error of a
 * rejected one. Never rejects; an unwritable log is reported on stderr.
 */
export async function logRunEnd(boxRoot: string, done: Promise<WakeupRunResult>): Promise<void> {
  const ts = (): string => new Date().toISOString();
  try {
    const result = await done;
    await writeBoxLog(boxRoot, {
      ts: ts(),
      event: "job-check",
      action: "run ended",
      box: boxRoot,
      ok: result.ok,
      jobsProcessed: result.outcome?.jobsProcessed ?? null,
      jobsRemaining: result.outcome?.jobsRemaining ?? null,
      detail: result.detail,
    });
  } catch (error) {
    try {
      await writeBoxLog(boxRoot, { ts: ts(), event: "job-check", action: "run ended", box: boxRoot, ok: false, error: errorMessage(error) });
    } catch (logError) {
      console.error(`[job-check] ${boxRoot}: could not record the end of a run (${errorMessage(error)})`, logError);
    }
  }
}

/**
 * Start one full wakeup for the job check and answer once its child has taken
 * the cycle lock. The run is its own admitted box work, detached from the
 * caller's (a request's or a pass's permit ends before the run does), and
 * its end is logged. A second call while this process has a run in flight
 * for the box answers `running` without spawning.
 */
export async function startJobCheckWakeup(boxRoot: string, opts?: { run?: WakeupRunner | undefined }): Promise<JobCheckStart> {
  if (inFlight.has(boxRoot)) return { state: "running", detail: "A job-check wakeup is already in flight for this box." };
  inFlight.add(boxRoot);
  let answer: (start: JobCheckStart) => void = () => {};
  const answered = new Promise<JobCheckStart>((resolve) => {
    answer = resolve;
  });
  const whole = withoutBoxWork(() =>
    withBoxWork({ boxRoot, reason: "job-check wakeup" }, async () => {
      const start = await startBbxWakeup({ boxRoot, triggeredBy: "job-check", maxCycles: TRIGGER_MAX_CYCLES, run: opts?.run ?? runBbxWakeup });
      answer({ state: start.state, detail: start.detail });
      await logRunEnd(boxRoot, start.done);
    }),
  );
  whole
    .catch((error: unknown) => {
      // Admission refused (the box is closed for maintenance) or the spawn
      // setup threw: no child took the lock. After an answer this is a no-op.
      answer({ state: "failed", detail: errorMessage(error) });
    })
    .finally(() => inFlight.delete(boxRoot))
    .catch((error: unknown) => console.error(`[job-check] ${boxRoot}: run bookkeeping failed`, error));
  return answered;
}
