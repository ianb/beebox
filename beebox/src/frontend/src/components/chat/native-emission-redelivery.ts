/**
 * Page-lifetime idempotency for native emission dispatch.
 *
 * The iOS shell redelivers a pending emission with the SAME id until a
 * receipt settles it — on navigation, on relaunch, and on a backoff while a
 * receipt is missing (docs/mobile-contract.md §4.2). A redelivered id must
 * share the original dispatch's outcome — re-posting its receipt to the
 * shell — never become a second optimistic send: dispatching it again paints
 * a duplicate message row in the transcript even though the server's claim
 * registry answers the duplicate POST idempotently.
 *
 * A rejected outcome clears the entry: the shell's Retry resets the emission
 * and redelivers the same id as a genuine new attempt, which must dispatch.
 * A reloaded page starts with an empty registry by design — the server
 * answers the re-POST `deduplicated: true`, and history reconciliation owns
 * the row.
 */

import type { Receipt } from "../../input/targets/receipts";

/** One entry per emission id this page has dispatched. */
export type NativeDispatchRegistry = Map<string, Promise<Receipt>>;

export function createNativeDispatchRegistry(): NativeDispatchRegistry {
  return new Map();
}

/**
 * Return the outcome for this delivery of `emissionId`: the already-running
 * dispatch when the shell redelivered an id this page has seen, else a fresh
 * dispatch. The caller posts the resolved receipt to the shell either way.
 */
export function resolveNativeDispatch(
  emissionId: string,
  { registry, dispatch }: { registry: NativeDispatchRegistry; dispatch: () => Promise<Receipt> }
): { outcome: Promise<Receipt>; redelivered: boolean } {
  const existing = registry.get(emissionId);
  if (existing !== undefined) {
    return { outcome: existing, redelivered: true };
  }
  const outcome = dispatch().then((receipt) => {
    // A rejection is per-attempt, not per-emission: forget the id so the
    // shell's Retry (same id, fresh attempt) dispatches for real.
    if (receipt.disposition === "rejected") registry.delete(emissionId);
    return receipt;
  }, (error: unknown) => {
    registry.delete(emissionId);
    throw error;
  });
  registry.set(emissionId, outcome);
  return { outcome, redelivered: false };
}
