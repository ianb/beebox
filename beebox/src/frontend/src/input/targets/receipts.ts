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
  | { disposition: "rejected"; emissionId: string; reason: string; definitive?: boolean };

interface PendingReceipt {
  resolves: Set<(receipt: Receipt) => void>;
  diagnosticTimer: ReturnType<typeof setTimeout>;
}

const PENDING_DIAGNOSTIC_MS = 30_000;

const pending = new Map<string, PendingReceipt>();

/**
 * Register interest in a send's outcome BEFORE dispatching it. Exactly one
 * settle wins. There is deliberately no elapsed-time verdict: `/chat/send`
 * resolves once the backend has durably recorded the message — since the
 * emission-model Track A reorder that is one disk write, not the engine's
 * (possibly minutes-long) cold start, so a POST still pending at
 * PENDING_DIAGNOSTIC_MS below is genuinely anomalous rather than an ordinary
 * cold spawn. Transport and backend failures settle explicitly; treating a
 * still-pending POST as rejected restores a message the server may later run.
 */
export function expectReceipt(emissionId: string): Promise<Receipt> {
  return new Promise((resolve) => {
    const entry = pending.get(emissionId);
    if (entry === undefined) {
      pending.set(emissionId, {
        resolves: new Set([resolve]),
        diagnosticTimer: setTimeout(() => {
          if (!pending.has(emissionId)) return;
          recordChatSendEvent(emissionId, {
            event: "receipt-pending",
            detail: { elapsedMs: PENDING_DIAGNOSTIC_MS },
          });
        }, PENDING_DIAGNOSTIC_MS),
      });
    } else {
      entry.resolves.add(resolve);
    }
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
  clearTimeout(entry.diagnosticTimer);
  for (const resolve of entry.resolves) resolve(receipt);
}

/** Test seam: outstanding expectation count. */
export function pendingReceiptCount(): number {
  return pending.size;
}
