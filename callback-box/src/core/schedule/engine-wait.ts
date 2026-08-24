/**
 * Scheduler-side view of engine unavailability (the deferred-recoverable
 * failure category): should this box's scheduled work run at all right now,
 * and was a just-failed run an engine casualty rather than a task defect?
 *
 * Consults the machine-level advisory store — fail-open throughout: any
 * trouble reading config or the store means "no wait", which degrades to
 * today's ordinary failure behavior.
 *
 * Design: docs/plans/deferred-recoverable-agent-failures.md
 */

import { getBoxTime } from "../../lib/time.js";
import { errorMessage } from "../../lib/error-guards.js";
import { CommandFailedError } from "../../lib/exec-with-timeout.js";
import { INCONCLUSIVE_EXIT_CODE, findInconclusiveLine } from "../../shared/inconclusive.js";
import { loadAgentEngine } from "../box/config.js";
import {
  liveEngineUnavailability,
  type StoredEngineUnavailability,
} from "../agent/engine-availability-store.js";
import {
  describeEngineUnavailability,
  formatRetryAt,
} from "../agent/engine-unavailability.js";

/** The live unavailability record for this box's engine, or null. */
export async function boxEngineUnavailability(
  boxRoot: string,
): Promise<StoredEngineUnavailability | null> {
  try {
    const provider = await loadAgentEngine(boxRoot);
    return await liveEngineUnavailability({ provider, now: getBoxTime(boxRoot) });
  } catch (e) {
    // Fail open: an availability hint must never block scheduled work.
    console.warn(`Could not consult engine availability for ${boxRoot}:`, e);
    return null;
  }
}

/** The one skip/waiting phrase every scheduler surface uses. */
export function engineWaitReason(live: StoredEngineUnavailability): string {
  return `waiting on ${live.provider} quota until ${formatRetryAt(live.retryAt)}`;
}

/** How a non-success scheduled run is recorded. */
export type ScheduleOutcomeResult = "failure" | "deferred" | "inconclusive";

/**
 * Recognize a run that exited "the work completed, the check did not decide".
 * Requires BOTH signals: the dedicated exit code AND the marker line the
 * procedure CLI prints. Either alone is ambiguous — some other tool may exit
 * 2, and the phrase could appear in an unrelated command's output — and
 * mislabeling a real failure as a non-verdict is exactly the direction of
 * error this whole change exists to prevent.
 */
function inconclusiveLine(error: unknown): string | null {
  if (!(error instanceof CommandFailedError)) return null;
  if (error.exitCode !== INCONCLUSIVE_EXIT_CODE) return null;
  return findInconclusiveLine(error.message);
}

/**
 * Classify a just-failed scheduled run. The failure is `deferred` — the
 * engine's, not the task's — only when a live unavailability record was
 * written during this run's own span; that freshness requirement stops the
 * store from laundering unrelated failures (a script that dies of its own
 * bug during someone else's quota episode fails normally). A stale-but-live
 * record doesn't need the deferred outcome: the skip gate stops the next
 * run before it starts.
 *
 * `inconclusive` is the third outcome: the command reported that its work
 * completed but its check reached no verdict. Like `deferred` it neither
 * increments nor resets `consecutiveFailures` — but for the opposite reason.
 * `deferred` means the task never really ran; `inconclusive` means it ran and
 * nobody judged it. Both are non-answers, and neither is a failure.
 * `deferred` is checked first: during an engine outage the missing verdict is
 * a symptom of the outage, and the outage is the more actionable fact.
 */
export async function classifyScheduleFailure(options: {
  boxRoot: string;
  runStartedAt: Date;
  error: unknown;
}): Promise<{ result: ScheduleOutcomeResult; error: string }> {
  const live = await boxEngineUnavailability(options.boxRoot);
  if (live !== null && new Date(live.detectedAt).getTime() >= options.runStartedAt.getTime()) {
    return { result: "deferred", error: describeEngineUnavailability(live) };
  }
  const inconclusive = inconclusiveLine(options.error);
  if (inconclusive !== null) {
    return { result: "inconclusive", error: inconclusive };
  }
  return { result: "failure", error: errorMessage(options.error) };
}
