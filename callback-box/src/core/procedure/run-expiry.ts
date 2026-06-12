/**
 * Run-card expiry — when a procedure run's directory may be deleted.
 *
 * Every run card gets an `expires` attribute stamped at completion: an ISO
 * datetime, or "never" to pin the run forever. Putting the expiration on the
 * run itself means anything (agent, human, a future retrospective tool) can
 * retain a specific run by editing its card. `cb procedure gc` then just
 * deletes whatever is past its date — run dirs are a recent cache, not an
 * archive; git history retains everything.
 */

import { parseDuration } from "../../schemas/scheduled-script-duration.js";
import type { ParsedProcedure } from "./engine-types.js";

/** Default expiry for completed runs. */
export const COMPLETED_RUN_EXPIRY = "30d";

/**
 * Default expiry for failed runs — longer than completed because failures
 * tend to get investigated late.
 */
export const FAILED_RUN_EXPIRY = "90d";

export class InvalidRunExpiryError extends Error {
  constructor(attr: string, value: string) {
    super(
      `Invalid ${attr}="${value}": use a duration like "30d" or "12w", or "never"`
    );
    this.name = "InvalidRunExpiryError";
  }
}

/**
 * Validate a run-expiry attribute value ("never" or a duration string).
 * Throws InvalidRunExpiryError so a bad procedure card fails at load time,
 * not after the run's work is already done.
 */
export function validateRunExpiry(attr: string, value: string): void {
  if (value === "never") return;
  try {
    parseDuration(value);
  } catch (_e) {
    throw new InvalidRunExpiryError(attr, value);
  }
}

/**
 * Parameters for computeRunExpires
 */
export interface ComputeRunExpiresParams {
  status: "completed" | "failed";
  completedAt: string;
  procedure: ParsedProcedure;
}

/**
 * Compute the `expires` attribute value for a finished run: the procedure
 * card's override if present, else the status-based default, applied to the
 * completion time. Returns "never" or an ISO datetime.
 */
export function computeRunExpires(params: ComputeRunExpiresParams): string {
  const { status, completedAt, procedure } = params;
  const override =
    status === "completed" ? procedure.runExpiry : procedure.failedRunExpiry;
  const spec =
    override ?? (status === "completed" ? COMPLETED_RUN_EXPIRY : FAILED_RUN_EXPIRY);
  if (spec === "never") return "never";
  return new Date(Date.parse(completedAt) + parseDuration(spec)).toISOString();
}
