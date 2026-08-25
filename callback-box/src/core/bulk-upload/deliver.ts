/**
 * Bulk-upload delivery — inject a prepared `upload-batch` as a first-class user
 * message into its target chat, and the `<upload>` wrapper that message carries.
 *
 * Reuses the shared deliver core (`core/chat/session/deliver-user-message.ts`);
 * unlike capture there is NO most-active fallback — a bulk batch is always
 * launched from a specific chat, so a target that no longer resolves is a broken
 * invariant — {@link resolveBulkTarget} returns null and the caller fails loudly,
 * leaving the batch retryable — never a heterogeneous file dump misdirected into
 * "whatever chat was most active".
 */

import type { ChatSessionRegistry } from "../chat/session/registry.js";
import { loadHistory } from "../chat/session/history.js";
import type { DeliveryTarget } from "../chat/session/deliver-user-message.js";

export { buildUploadWrapper } from "../../shared/delivered-user-message.js";

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
  /** Consulted so a chat that is reserved but has not run yet still counts. */
  registry?: ChatSessionRegistry | undefined;
}): Promise<DeliveryTarget | null> {
  // A reserved chat (`chat/session/reserve.ts`) has no history entry until its
  // first turn, which for a batch dropped into a brand-new chat is this
  // delivery. Unlike capture there is still no most-active fallback: a batch
  // either reaches the chat it was launched from or stays retryable.
  if (opts.registry?.getReservation(opts.targetSessionId) != null) {
    return { sessionId: opts.targetSessionId, contextDir: opts.contextDir };
  }
  const known = await loadHistory(opts.boxRoot);
  if (!known.includes(opts.targetSessionId)) return null;
  return { sessionId: opts.targetSessionId, contextDir: opts.contextDir };
}
