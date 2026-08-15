/**
 * Receipt correlation for chat sends (docs/implemented-plans/input-extraction.md,
 * chunk 3). The send outcome is consumed deep inside the chat machine's
 * stream actor today; this registry gives the dispatcher an async answer
 * without restructuring the machine: the dispatcher `expect()`s a receipt
 * under the emission's id (the wire messageId) before dispatching, and
 * the outcome sites in chat-actors settle it.
 *
 * Receipts are ACCEPTANCE-level, not completion-level: `sent` means the
 * backend started (or had already processed — dedup) a turn; `queued`
 * means it parked the message behind the running turn; `rejected` means
 * the submission itself failed (transport, no turn id). Turn *completion*
 * stays the machine's business (STREAM_RESULT et al).
 *
 * Framework-free and serializable-boundary-clean (input/ rule): no React,
 * no DOM, values only.
 */

import { chatSendReasonKind, recordChatSendEvent } from "../../lib/chat-send-diagnostics";

export type Receipt =
  | { disposition: "sent"; emissionId: string; deduplicated: boolean }
  | { disposition: "queued"; emissionId: string }
  | { disposition: "rejected"; emissionId: string; reason: string };

interface PendingReceipt {
  resolve: (receipt: Receipt) => void;
}

const pending = new Map<string, PendingReceipt>();

/**
 * Register interest in a send's outcome BEFORE dispatching it. Exactly one
 * settle wins. There is deliberately no elapsed-time verdict: `/chat/send`
 * resolves only after the backend accepts the turn, and cold startup can take
 * several minutes. Transport and backend failures settle explicitly; treating
 * a still-pending POST as rejected restores a message the server may later run.
 */
export function expectReceipt(emissionId: string): Promise<Receipt> {
  // A duplicate expectation for the same id (a double dispatch) supersedes
  // the older one: settle it as rejected now, so one promise cannot remain
  // stranded behind another expectation carrying the same correlation id.
  settleReceipt({ disposition: "rejected", emissionId, reason: "superseded by a newer send with the same id" });
  return new Promise((resolve) => {
    pending.set(emissionId, { resolve });
  });
}

/**
 * Report a send's outcome. A no-op when nothing expects this id (sends
 * that predate the registry, system sends like /compact, double settles)
 * — outcome sites can call this unconditionally.
 */
export function settleReceipt(receipt: Receipt): void {
  recordChatSendEvent(receipt.emissionId, { event: "receipt-settled", detail: { disposition: receipt.disposition,
    ...(receipt.disposition === "rejected" ? { reasonKind: chatSendReasonKind(receipt.reason) } : {}) } });
  const entry = pending.get(receipt.emissionId);
  if (entry === undefined) return;
  pending.delete(receipt.emissionId);
  entry.resolve(receipt);
}

/** Test seam: outstanding expectation count. */
export function pendingReceiptCount(): number {
  return pending.size;
}
