import type { ReservationReceipt, ReservationReceipts } from "./reservation-receipts";

type Reserve = (receipt: ReservationReceipt) => Promise<{ kind: "reserved" | "taken" | "unsupported" }>;

class ReservationRecoveryUnsupportedError extends Error {
  constructor() {
    super("This conversation's reservation could not be restored.");
    this.name = "ReservationRecoveryUnsupportedError";
  }
}

/** History consumers must restore the engine's pre-send authority before refreshing. */
export function createReservationRecovery(receipts: ReservationReceipts | null, reserve: Reserve) {
  const pending = new Map<string, Promise<ReservationReceipt | null>>();
  return function ensureReservation(sessionId: string): Promise<ReservationReceipt | null> {
    const receipt = receipts?.get(sessionId);
    if (!receipt) return Promise.resolve(null);
    const existing = pending.get(sessionId);
    if (existing) return existing;
    const recovery = Promise.resolve().then(async () => {
      // Sending/deleting may have retired this receipt before the queued work starts.
      if (!receipts?.get(sessionId)) return null;
      const result = await reserve(receipt);
      if (result.kind === "unsupported") throw new ReservationRecoveryUnsupportedError();
      return receipt;
    }).finally(() => { pending.delete(sessionId); });
    pending.set(sessionId, recovery);
    return recovery;
  };
}
