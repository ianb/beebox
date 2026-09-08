import { z } from "zod";

const receiptSchema = z.object({
  sessionId: z.string().min(1),
  contextDir: z.string(),
  engine: z.enum(["claude", "codex"]),
  model: z.string().optional(),
});
export type ReservationReceipt = z.infer<typeof receiptSchema>;
export type ReservationReceiptStorage = Pick<Storage, "getItem" | "setItem">;

/** Same-tab proof that this client successfully reserved an otherwise empty id. */
export class ReservationReceipts {
  private readonly key: string;
  private records: Map<string, ReservationReceipt>;

  constructor(private readonly storage: ReservationReceiptStorage, storageScope: string) {
    this.key = `bbx-conversation-reservations:${storageScope}`;
    const raw = storage.getItem(this.key);
    if (raw === null) {
      this.records = new Map();
      return;
    }
    let decoded: unknown;
    try {
      decoded = JSON.parse(raw);
    } catch (_parseError) {
      this.records = new Map();
      return;
    }
    const parsed = z.array(z.tuple([z.string().min(1), receiptSchema])).safeParse(decoded);
    if (!parsed.success || parsed.data.some(([id, receipt]) => receipt.sessionId !== id)) {
      this.records = new Map();
      return;
    }
    this.records = new Map(parsed.data);
  }

  get(sessionId: string): ReservationReceipt | undefined {
    return this.records.get(sessionId);
  }

  put(receipt: ReservationReceipt): void {
    const next = new Map(this.records);
    next.set(receipt.sessionId, receipt);
    this.storage.setItem(this.key, JSON.stringify([...next]));
    this.records = next;
  }

  remove(sessionId: string): void {
    if (!this.records.has(sessionId)) return;
    const next = new Map(this.records);
    next.delete(sessionId);
    this.storage.setItem(this.key, JSON.stringify([...next]));
    this.records = next;
  }
}
