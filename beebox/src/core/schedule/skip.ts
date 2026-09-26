/**
 * Why a schedule could not run, and the latch a boxholder-requested schedule
 * uses so it says so once per episode. See docs/plans/notifications.md
 * (Track E, "Promotion") and `promotion.ts`.
 *
 * The tick records `skipped: { reason, since }` in schedule state when a due
 * card is held back by one of `TICK_SKIP_REASONS`; any run clears it. The
 * promotion latch lives in the existing `alertedFor` field as
 * `skipped:<reason>`, beside the health values.
 */

import { assertNever } from "../../lib/invariant.js";
import type { DeferReason } from "./defer-reason.js";
import type { StoredEngineUnavailability } from "../agent/engine-availability-store.js";

/** Reasons the tick holds a due card back that are recorded in state. */
export const TICK_SKIP_REASONS = ["missing-connectors", "engine-quota"] as const;
export type TickSkipReason = (typeof TICK_SKIP_REASONS)[number];

/** Why the tick held a due card back, with what the promotion's message needs. */
export type SkipCause =
  | { reason: "missing-connectors"; connectors: string[] }
  | { reason: "engine-quota"; live: StoredEngineUnavailability };

/** The tick's recorded skip episode. */
export interface SkippedEpisode {
  reason: TickSkipReason;
  /** When this episode began: the first tick that skipped for this reason. */
  since: string;
}

export const ALERTED_FOR = [
  "failing",
  "overdue",
  "invalid",
  "skipped:missing-connectors",
  "skipped:engine-quota",
  "skipped:connector-failing",
  "skipped:unconfigured",
] as const;
export type AlertedFor = (typeof ALERTED_FOR)[number];

/**
 * Whether a latch survives a run with this outcome. A health latch
 * (`failing`, `overdue`, `invalid`) clears on success. A skip latch clears on
 * any run, except when the run is itself the condition: a run that deferred
 * for want of the Jev key keeps `skipped:unconfigured`, and
 * `skipped:connector-failing` is cleared by the tick when the connector's
 * failing episode ends, since the script runs through it.
 */
export function latchSurvivesRun(
  alertedFor: AlertedFor | null,
  run: { result: "success" | "failure" | "deferred" | "inconclusive"; deferReason: DeferReason | null },
): boolean {
  switch (alertedFor) {
    case null:
    case "failing":
    case "overdue":
    case "invalid":
      return run.result !== "success";
    case "skipped:missing-connectors":
    case "skipped:engine-quota":
      return false;
    case "skipped:connector-failing":
      return true;
    case "skipped:unconfigured":
      return run.result === "deferred" && run.deferReason === "unconfigured";
    default:
      return assertNever(alertedFor);
  }
}

