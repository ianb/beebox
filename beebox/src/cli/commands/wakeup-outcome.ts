/**
 * A machine-readable account of what one `bbx wakeup` actually did.
 *
 * Why this exists: the process exit code is set from the connector step alone
 * (`wakeup-connectors.ts`, `errorCount > 0 ? 1 : undefined`), so it answers
 * "did anything on this box go wrong", not "did the work I asked for
 * succeed". A supervising caller that retries on non-zero therefore retries
 * forever on a box with an unrelated broken connector — an expired Google
 * token did exactly that to the scan promote worker in production, which is
 * the incident `core/scan/wakeup-retry.ts` bounds and this module removes the
 * cause of.
 *
 * The exit code is deliberately unchanged: humans and scripts rely on non-zero
 * meaning "something went wrong here". This adds a channel beside it for
 * callers that need to know *which* step.
 *
 * Emission is opt-in via `BBX_WAKEUP_OUTCOME=1` so an interactive `bbx wakeup`
 * prints nothing extra — routine success should be quiet.
 */

import { isRecord } from "../../lib/is-record.js";

/** Set by a supervising caller that intends to parse the outcome line. */
export const WAKEUP_OUTCOME_ENV = "BBX_WAKEUP_OUTCOME";

/** Line prefix, chosen to be greppable and not to collide with prose. */
export const WAKEUP_OUTCOME_PREFIX = "[wakeup-outcome] ";

export interface WakeupOutcomeReport {
  /** Connectors that errored. Not the reactor's fault, and not a reason to
   * retry a job-drain that already succeeded. */
  readonly connectorErrors: number;
  /** Whether the reactor cycle itself completed. This is the step a caller
   * waiting on an intake job actually depends on. */
  readonly reactorOk: boolean;
  readonly jobsProcessed: number;
  /** Jobs left queued. Routinely non-zero for benign reasons — the reactor
   * skips low-priority work — so it is NOT a failure signal. */
  readonly jobsRemaining: number;
}

/** Print the outcome, if the caller asked for it. */
export function reportWakeupOutcome(report: WakeupOutcomeReport): void {
  if (process.env[WAKEUP_OUTCOME_ENV] !== "1") return;
  console.log(WAKEUP_OUTCOME_PREFIX + JSON.stringify(report));
}

/**
 * Recover the outcome from captured wakeup output, or null when the run
 * produced none — an older binary, a crash before the end of the cycle, or a
 * caller that did not opt in. Null means "no information", and a caller must
 * fall back to the exit code rather than assuming success.
 *
 * The last occurrence wins: output may contain earlier lines from nested runs.
 */
export function parseWakeupOutcome(output: string): WakeupOutcomeReport | null {
  const lines = output.split("\n").filter((line) => line.includes(WAKEUP_OUTCOME_PREFIX));
  const last = lines.at(-1);
  if (last === undefined) return null;
  const json = last.slice(last.indexOf(WAKEUP_OUTCOME_PREFIX) + WAKEUP_OUTCOME_PREFIX.length).trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (_e) {
    /* ignore: truncated or interleaved output is "no information", not a
       failure claim — the caller falls back to the exit code. */
    return null;
  }
  if (!isRecord(parsed)) return null;
  const { connectorErrors, reactorOk, jobsProcessed, jobsRemaining } = parsed;
  if (
    typeof connectorErrors !== "number" ||
    typeof reactorOk !== "boolean" ||
    typeof jobsProcessed !== "number" ||
    typeof jobsRemaining !== "number"
  ) {
    return null;
  }
  return { connectorErrors, reactorOk, jobsProcessed, jobsRemaining };
}
