/**
 * Per-session staging caps (X3).
 *
 * A single point of definition so the store (enforcement) and the upload route
 * (413 mapping) agree. A staging session is short-lived scratch space, so these
 * bound a runaway or abusive client, not a real capture: 1 GiB of media and 500
 * items (audio chunks + photos + files) are far past any legitimate hand
 * capture.
 */

import type { StagingSession } from "./staging-store.js";

export const MAX_STAGED_BYTES = 1024 * 1024 * 1024; // 1 GiB
export const MAX_STAGED_ITEMS = 500;

/** An upload would push the session past {@link MAX_STAGED_BYTES}. */
export class StagingByteLimitError extends Error {
  constructor() {
    super("Capture exceeds the staging byte limit");
    this.name = "StagingByteLimitError";
  }
}

/** An upload would push the session past {@link MAX_STAGED_ITEMS}. */
export class StagingItemLimitError extends Error {
  constructor() {
    super("Capture exceeds the staging item limit");
    this.name = "StagingItemLimitError";
  }
}

/** Either staging-cap violation — the upload route maps both to a 413. */
export function isStagingLimitError(e: unknown): e is StagingByteLimitError | StagingItemLimitError {
  return e instanceof StagingByteLimitError || e instanceof StagingItemLimitError;
}

/** Total staged items: audio chunks across every segment + photos + files. */
function stagedItemCount(session: StagingSession): number {
  const chunks = session.segments.reduce((n, s) => n + s.chunks.length, 0);
  return chunks + session.photos.length + session.files.length;
}

/**
 * Throw if adding one item of `incomingBytes` would push the session past
 * either cap. Called under the per-session lock so concurrent uploads can't each
 * individually pass and jointly overshoot.
 */
export function enforceStagingLimits(opts: { session: StagingSession; incomingBytes: number }): void {
  const { session, incomingBytes } = opts;
  if ((session.totalBytes ?? 0) + incomingBytes > MAX_STAGED_BYTES) throw new StagingByteLimitError();
  if (stagedItemCount(session) + 1 > MAX_STAGED_ITEMS) throw new StagingItemLimitError();
}
