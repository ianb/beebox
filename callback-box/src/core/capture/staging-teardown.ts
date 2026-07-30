/**
 * Staging-session teardown: the two ways a session's directory goes away.
 *
 * Split out of `staging-store.ts` to keep it under the line cap. The pair
 * belongs together — `cleanupStagingSession` is the unconditional teardown the
 * worker calls once a batch is delivered, and
 * `discardStagingSessionIfCancellable` is the guarded one a *client* cancel goes
 * through, which must refuse a batch the worker already owns.
 */

import * as fs from "node:fs/promises";
import { stagingSessionDir, type StagingSessionState } from "./staging-schema.js";
import { StagingSessionGoneError } from "./staging-errors.js";
import { withStagingLock, releaseStagingLock, readStagingSession } from "./staging-store.js";

/**
 * Tear down a session: remove its directory and drop its lock-map entry in one
 * step, so the in-process lock can't outlive the session.
 */
export async function cleanupStagingSession(opts: { boxRoot: string; id: string }): Promise<void> {
  const { boxRoot, id } = opts;
  try {
    await fs.rm(stagingSessionDir(boxRoot, id), { recursive: true, force: true });
  } catch (e) {
    console.error(`[capture] Failed to clean up staging session ${id}:`, e);
  }
  releaseStagingLock(id);
}

/** Outcome of a {@link discardStagingSessionIfCancellable} attempt. */
export interface DiscardResult {
  discarded: boolean;
  /** The state that blocked the discard (absent when it succeeded). */
  blockedBy?: StagingSessionState;
}

/**
 * Discard a session only while it is still the uploader's to discard — the
 * read-check-delete runs under the per-session lock so it cannot race the seal.
 *
 * An `open` batch is still uploading and a `failed:*` one is dead, so both may
 * be thrown away. Anything past the seal (`sealed`/`preparing`/`delivering`/
 * `delivered`) belongs to the background worker: deleting the directory under it
 * makes the worker read `null` and silently return, so the user gets no
 * `<upload>` message while their client — which already saw finalize succeed —
 * reports success. Checking the state outside the lock would leave exactly that
 * race open, which is why this lives here rather than in the route.
 */
export async function discardStagingSessionIfCancellable(opts: {
  boxRoot: string;
  id: string;
}): Promise<DiscardResult> {
  const { boxRoot, id } = opts;
  return withStagingLock(id, async () => {
    const session = await readStagingSession({ boxRoot, id });
    if (!session) throw new StagingSessionGoneError(id);
    const cancellable = session.state === "open" || session.state.startsWith("failed:");
    if (!cancellable) return { discarded: false, blockedBy: session.state };
    try {
      await fs.rm(stagingSessionDir(boxRoot, id), { recursive: true, force: true });
    } catch (e) {
      console.error(`[capture] Failed to discard staging session ${id}:`, e);
      throw e;
    }
    return { discarded: true };
  });
}
