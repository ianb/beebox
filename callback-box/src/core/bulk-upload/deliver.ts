/**
 * Bulk-upload delivery — inject a prepared `upload-batch` as a first-class user
 * message into its target chat, and the `<upload>` wrapper that message carries.
 *
 * Reuses the shared deliver core (`core/chat/session/deliver-user-message.ts`);
 * unlike capture there is NO most-active fallback — a bulk batch is always
 * launched from a specific chat, so a target that no longer resolves is a broken
 * invariant (→ {@link BulkTargetGoneError}, batch left retryable), never a
 * heterogeneous file dump misdirected into "whatever chat was most active".
 */

import { loadHistory } from "../chat/session/history.js";
import type { DeliveryTarget } from "../chat/session/deliver-user-message.js";

export { buildUploadWrapper } from "../../shared/delivered-user-message.js";

/** Raised when a bulk batch's target chat no longer resolves at delivery. Retryable. */
export class BulkTargetGoneError extends Error {
  constructor(targetSessionId: string) {
    super(`Bulk batch target chat ${targetSessionId} no longer exists`);
    this.name = "BulkTargetGoneError";
  }
}

/**
 * Resolve a bulk batch's delivery target from on-disk state (no session is
 * created here). Returns the target when the batch's `targetSessionId` is still
 * a chat this box knows; returns `null` — the broken-invariant signal — when it
 * isn't (the caller fails loudly and leaves the batch retryable). No
 * most-active fallback, by design.
 */
export async function resolveBulkDeliveryTarget(opts: {
  boxRoot: string;
  targetSessionId: string;
  contextDir: string;
}): Promise<DeliveryTarget | null> {
  const known = await loadHistory(opts.boxRoot);
  if (!known.includes(opts.targetSessionId)) return null;
  return { sessionId: opts.targetSessionId, contextDir: opts.contextDir };
}
