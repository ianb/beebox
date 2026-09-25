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
 * `connectors` is the same channel one level down, and it is what a forced
 * wakeup (`bbx force-wakeup`) hands back to an agent: per connector, what it
 * created, and — when it did nothing — whether that was a failure or a
 * deliberate skip with a reason. Without it a forced run reports "0 errors"
 * for a service it never contacted, which is the invisible-nothing-happened
 * failure the 2026-09-14 incident was made of
 * (`docs/plans/agent-capability-delegation.md`).
 *
 * Emission is opt-in via `BBX_WAKEUP_OUTCOME=1` so an interactive `bbx wakeup`
 * prints nothing extra — routine success should be quiet.
 */

import { z } from "zod";
import type { SyncSkipped } from "../../connectors/index.js";

/** Set by a supervising caller that intends to parse the outcome line. */
export const WAKEUP_OUTCOME_ENV = "BBX_WAKEUP_OUTCOME";

/** Line prefix, chosen to be greppable and not to collide with prose. */
export const WAKEUP_OUTCOME_PREFIX = "[wakeup-outcome] ";

/**
 * What one connector did in this cycle.
 *
 * `success: true` with a `skipped` is the case callers get wrong: the
 * connector ran and deliberately did nothing, so counting it as "up to date"
 * claims work that never happened.
 */
export interface WakeupConnectorOutcome {
  readonly name: string;
  readonly success: boolean;
  readonly created: number;
  readonly updated: number;
  readonly pushed: number;
  readonly jobs: number;
  readonly skipped?: SyncSkipped | undefined;
  readonly error?: string | undefined;
}

export interface WakeupOutcomeReport {
  /** Connectors that errored. Not the reactor's fault, and not a reason to
   * retry a job-drain that already succeeded. */
  readonly connectorErrors: number;
  /** One entry per connector the cycle actually attempted, plus one for a
   * `--connector` name that matched nothing. Empty when the cycle was
   * skipped, or when the box configures no connectors. */
  readonly connectors: readonly WakeupConnectorOutcome[];
  /** Whether the reactor cycle itself completed. This is the step a caller
   * waiting on an intake job actually depends on. */
  readonly reactorOk: boolean;
  /** True when another reactor held the lock, so this cycle did no work.
   * `reactorOk` is still true — nothing failed — but no job drained, so a
   * caller waiting on one has learned nothing and must try again. */
  readonly reactorSkipped: boolean;
  readonly jobsProcessed: number;
  /** Jobs left queued. Routinely non-zero for benign reasons — the reactor
   * skips low-priority work — so it is NOT a failure signal. */
  readonly jobsRemaining: number;
  /** Present when another cycle held the per-box wakeup lock
   * (`wakeup-cycle-lock.ts`), so this process did nothing at all — not even
   * the connector step. Every count above is zero because nothing ran, which
   * is why a caller must check this before reading them as an answer. */
  readonly skipped?: "wakeup-running" | undefined;
}

/**
 * The wire shape, validated rather than trusted: the line crossed a process
 * boundary, and a half-written or older-binary one must read as "no
 * information" rather than as a shape the caller then indexes into.
 *
 * A skip reason `SyncSkipped` gains later would be rejected here until this
 * list grows — which costs the report, not correctness: an unparsed line is
 * already defined as no information, and the caller falls back to the exit
 * code.
 */
const connectorSchema = z.object({
  name: z.string(),
  success: z.boolean(),
  created: z.number(),
  updated: z.number(),
  pushed: z.number(),
  jobs: z.number(),
  skipped: z.object({ reason: z.enum(["not-configured", "not-allowed"]), detail: z.string() }).optional(),
  error: z.string().optional(),
});

const reportSchema = z.object({
  connectorErrors: z.number(),
  connectors: z.array(connectorSchema),
  reactorOk: z.boolean(),
  reactorSkipped: z.boolean(),
  jobsProcessed: z.number(),
  jobsRemaining: z.number(),
  skipped: z.literal("wakeup-running").optional(),
});

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
  const result = reportSchema.safeParse(parsed);
  if (!result.success) return null;
  return result.data;
}
