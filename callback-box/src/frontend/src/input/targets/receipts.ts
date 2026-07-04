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

export type Receipt =
  | { disposition: "sent"; emissionId: string; deduplicated: boolean }
  | { disposition: "queued"; emissionId: string }
  | { disposition: "rejected"; emissionId: string; reason: string };

interface PendingReceipt {
  resolve: (receipt: Receipt) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** Settlement backstop: a send whose outcome never reports (a code path
 * we missed, an actor torn down mid-flight) rejects rather than hangs. */
const RECEIPT_TIMEOUT_MS = 30_000;

const pending = new Map<string, PendingReceipt>();

/**
 * Register interest in a send's outcome BEFORE dispatching it. Exactly one
 * settle wins; the timeout backstop rejects (disposition, not a thrown
 * error) if nothing reports.
 */
export function expectReceipt(emissionId: string): Promise<Receipt> {
  // A duplicate expectation for the same id (a double dispatch) supersedes
  // the older one: settle it as rejected now, so its promise doesn't hang
  // until timeout and its timer can't fire later against the new entry.
  settleReceipt({ disposition: "rejected", emissionId, reason: "superseded by a newer send with the same id" });
  return new Promise((resolve) => {
    const entry: PendingReceipt = {
      resolve,
      timer: setTimeout(() => {
        if (pending.get(emissionId) !== entry) return;
        pending.delete(emissionId);
        resolve({ disposition: "rejected", emissionId, reason: "no outcome reported (timeout)" });
      }, RECEIPT_TIMEOUT_MS),
    };
    pending.set(emissionId, entry);
  });
}

/**
 * Report a send's outcome. A no-op when nothing expects this id (sends
 * that predate the registry, system sends like /compact, double settles)
 * — outcome sites can call this unconditionally.
 */
export function settleReceipt(receipt: Receipt): void {
  const entry = pending.get(receipt.emissionId);
  if (entry === undefined) return;
  pending.delete(receipt.emissionId);
  clearTimeout(entry.timer);
  entry.resolve(receipt);
}

/** Test seam: outstanding expectation count. */
export function pendingReceiptCount(): number {
  return pending.size;
}
