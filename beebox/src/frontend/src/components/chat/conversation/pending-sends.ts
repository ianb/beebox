/**
 * Completed WEB emissions held for delivery, separate from the live draft.
 * The native repository owns native content; never stage a native emission here.
 * Session storage scopes recovery to one tab/app instance. No load path sends anything.
 */
import { z } from "zod";
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- Pure recovery module runs in tap/tsx outside Vite, where @shared cannot resolve.
import { sendBindingSchema, type SendBinding } from "../../../../../shared/chat-composer-binding.js";
import type { Emission } from "../../../input/emission";

export interface PendingConversationSend {
  readonly emission: Emission;
  readonly binding: SendBinding;
  /**
   * `awaitingHq`: a `preparing` voice row whose tab reloaded while it waited
   * for its HQ transcript. It stays visible with explicit actions and is
   * never sent by a load (docs/plans/resilient-voice-recording.md, Track 4).
   */
  readonly status: "preparing" | "awaitingHq" | "pending" | "rejected" | "recovered" | "accepted" | "restored";
  readonly reason?: string;
  /** The staged voice recording this send is waiting on (voice sends with HQ only). */
  readonly recordingId?: string;
}
export interface PendingSendsStore {
  getSnapshot(): readonly PendingConversationSend[];
  subscribe(listener: () => void): () => void;
  /** Synchronous, durable before publication. Throws before the caller clears. */
  stage(emission: Emission, binding: SendBinding): void;
  /**
   * Durable realtime snapshot before HQ replaces its text under the same ID.
   * `recordingId` names the staged recording the HQ wait is for.
   */
  prepare(emission: Emission, opts: { binding: SendBinding; recordingId?: string }): void;
  accepted(id: string): void;
  rejected(id: string, reason: string): void;
  /** Remove only after the explicit restore callback succeeded. */
  restored(id: string): void;
  /** The user dismissed an `awaitingHq` row; its recording stays on the box. */
  dismissed(id: string): void;
}
export type PendingSendsStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
interface PendingSendsLocation { boxSlug: string; storageScope: string }

// The draft serializer intentionally drops large images and does not carry
// speech/HQ metadata. Completed sends need a lossless envelope instead: storage
// refusal must keep the caller's draft, never silently change its message.
const emissionSchema = z.object({
  id: z.string().min(1), origin: z.enum(["typed", "voice"]), text: z.string(),
  diarized: z.boolean(),
  images: z.array(z.object({ id: z.number(), mimeType: z.string(), dataBase64: z.string() })),
  files: z.array(z.object({
    id: z.number(), path: z.string(), originalName: z.string().optional(),
    size: z.number().optional(), mimetype: z.string().optional(),
  })),
  selections: z.array(z.object({
    id: z.number(), ref: z.string(), text: z.string(), position: z.string(),
    anchor: z.string().nullable().optional(), spokenWords: z.number().nullable().optional(),
  })),
  words: z.array(z.object({ word: z.string(), confidence: z.number().optional() })).optional(),
  spokenStart: z.number().optional(), hqText: z.literal(true).optional(), hqService: z.string().optional(),
  // Legacy rows from before late correction was removed stored "pending" or
  // "failed" (which message follows); both now collapse to the one-value
  // provenance bit.
  hqFallback: z.union([z.literal(true), z.enum(["pending", "failed"]).transform((): true => true)]).optional(),
});
// PendingConversationSend is also the live store API; bind its storage schema
// to that domain type so either side fails typecheck if their fields drift.
const savedRowSchema: z.ZodType<PendingConversationSend> = z.object({
  emission: emissionSchema, binding: sendBindingSchema,
  status: z.enum(["preparing", "awaitingHq", "pending", "rejected", "recovered", "accepted", "restored"]), reason: z.string().optional(),
  recordingId: z.string().optional(),
});
const savedRowsSchema = z.object({ version: z.literal(1), rows: z.array(savedRowSchema) });

class PendingSendBoxError extends Error {
  constructor() {
    super("Saved message belongs to a different box");
    this.name = "PendingSendBoxError";
  }
}
class PendingSendChangedError extends Error {
  constructor() {
    super("A saved message cannot change its destination or content");
    this.name = "PendingSendChangedError";
  }
}

/** Fail closed on damaged storage: do not overwrite the user's recovery copy. */
function loadRows(storage: PendingSendsStorage, { key, boxSlug }: { key: string; boxSlug: string }): PendingConversationSend[] {
  const raw = storage.getItem(key);
  if (raw === null) return [];
  return parseRows(raw, boxSlug);
}

function parseRows(raw: string, boxSlug: string): PendingConversationSend[] {
  const parsed: unknown = JSON.parse(raw);
  const saved = savedRowsSchema.parse(parsed);
  if (saved.rows.some((row) => row.binding.boxSlug !== boxSlug)) {
    throw new PendingSendBoxError();
  }
  return saved.rows.map((row): PendingConversationSend => {
    // A voice send interrupted while it waited for HQ keeps waiting visibly:
    // its recording and HQ job live on the box, and the user picks the text.
    if ((row.status === "preparing" || row.status === "awaitingHq") && row.recordingId !== undefined) {
      return { ...row, status: "awaitingHq", reason: "Waiting for the HQ transcript. Nothing is sent until you choose." };
    }
    if (row.status === "pending" || row.status === "preparing" || row.status === "awaitingHq") {
      return { ...row, status: "recovered", reason: "Delivery was interrupted. Review before retrying." };
    }
    return row;
  });
}

export interface PendingSendRecoveryCopy { key: string; raw: string }
const quarantinePrefix = (storageScope: string) => `bbx-pending-web-sends-quarantine:${storageScope}:`;

/** Preserved copies remain accessible after reload in the same tab. */
export function pendingSendRecoveryCopies(storage: PendingSendsStorage, storageScope: string): PendingSendRecoveryCopy[] {
  const copies: PendingSendRecoveryCopy[] = [];
  for (let index = 0; ; index++) {
    const key = `${quarantinePrefix(storageScope)}${index}`;
    const raw = storage.getItem(key);
    if (raw === null) return copies;
    copies.push({ key, raw });
  }
}

class PendingSendPreservationError extends Error {
  constructor() {
    super("The unreadable saved messages could not be preserved. Your draft and the original saved copy have been kept.");
    this.name = "PendingSendPreservationError";
  }
}

/**
 * Explicit recovery only: verify a byte-for-byte quarantine write BEFORE
 * removing unreadable rows. Valid saved messages are never reset by this action.
 * Storage access failure still refuses sending: completed-emission durability
 * is required, unlike the best-effort selected-conversation history preference.
 */
export function quarantineUnreadablePendingSends(storage: PendingSendsStorage, location: PendingSendsLocation): PendingSendsStore {
  const { boxSlug, storageScope } = location;
  const key = `bbx-pending-web-sends:${storageScope}`;
  const raw = storage.getItem(key);
  let unreadable = false;
  if (raw !== null) {
    try { parseRows(raw, boxSlug); }
    catch (_parseCause) { unreadable = true; }
  }
  if (unreadable && raw !== null) {
    const copies = pendingSendRecoveryCopies(storage, storageScope);
    const copyKey = copies.find((copy) => copy.raw === raw)?.key
      ?? `${quarantinePrefix(storageScope)}${copies.length}`;
    storage.setItem(copyKey, raw);
    if (storage.getItem(copyKey) !== raw) throw new PendingSendPreservationError();
    storage.removeItem(key);
  }
  return createPendingSendsStore(storage, location);
}

export function createPendingSendsStore(storage: PendingSendsStorage, { boxSlug, storageScope }: PendingSendsLocation): PendingSendsStore {
  const key = `bbx-pending-web-sends:${storageScope}`;
  let rows: readonly PendingConversationSend[] = loadRows(storage, { key, boxSlug });
  const listeners = new Set<() => void>();
  function publish(next: readonly PendingConversationSend[]): void {
    rows = next;
    for (const listener of listeners) listener();
  }
  function commit(next: readonly PendingConversationSend[]): void {
    // All bytes, including image payloads, must land before any live state moves.
    if (next.length === 0) storage.removeItem(key);
    else storage.setItem(key, JSON.stringify({ version: 1, rows: next }));
    publish(next);
  }
  function remove(id: string): void {
    const next = rows.filter((row) => row.emission.id !== id);
    if (next.length !== rows.length) commit(next);
  }
  function finish(id: string, status: "accepted" | "restored"): void {
    try { remove(id); }
    catch (_removeCause) {
      // Delivery/restore already happened. Failed recovery cleanup cannot
      // expose it as another send or merge operation in this live page.
      const reason = status === "accepted" ? "Sent. The saved recovery copy could not be cleared."
        : "Removed. The saved recovery copy could not be cleared.";
      const finished = rows.map((row): PendingConversationSend => row.emission.id === id
        ? { ...row, status, reason } : row);
      try { commit(finished); } catch (_writeCause) { publish(finished); }
    }
  }
  function stage(emission: Emission, opts: { binding: SendBinding; status: "preparing" | "pending"; recordingId?: string }): void {
      const { binding, status } = opts;
      if (binding.boxSlug !== boxSlug) throw new PendingSendBoxError();
      const recordingId = opts.recordingId === undefined ? {} : { recordingId: opts.recordingId };
      const normalized = savedRowSchema.parse(JSON.parse(JSON.stringify({ emission, binding, status, ...recordingId })));
      const existing = rows.find((row) => row.emission.id === emission.id);
      if (existing?.status === "accepted" || existing?.status === "restored") throw new PendingSendChangedError();
      if (existing !== undefined) {
        // A row still waiting on HQ may change its text once (HQ or fallback
        // replaces the realtime snapshot under the same ID); nothing else may.
        const replaceable = existing.status === "preparing" || existing.status === "awaitingHq";
        if (status === "preparing" && !replaceable) throw new PendingSendChangedError();
        // A retry's ID always retains the original content and destination.
        if ((!replaceable && JSON.stringify(existing.emission) !== JSON.stringify(normalized.emission))
          || JSON.stringify(existing.binding) !== JSON.stringify(normalized.binding)) {
          throw new PendingSendChangedError();
        }
        commit(rows.map((row) => row === existing ? normalized : row));
        return;
      }
      // Parse a serialized copy so later mutations to caller-owned arrays cannot
      // alter the already-bound completed send. Validation also matches reload.
      commit([...rows, normalized]);
  }
  return {
    getSnapshot: () => rows,
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    stage: (emission, binding) => { stage(emission, { binding, status: "pending" }); },
    prepare: (emission, opts) => { stage(emission, { ...opts, status: "preparing" }); },
    accepted: (id) => { finish(id, "accepted"); },
    restored: (id) => { finish(id, "restored"); },
    dismissed: (id) => { finish(id, "restored"); },
    rejected: (id, reason) => {
      if (!rows.some((row) => row.emission.id === id)) return;
      const rejected = rows.map((row): PendingConversationSend => row.emission.id === id && row.status !== "accepted" && row.status !== "restored"
        ? { ...row, status: "rejected", reason } : row);
      try { commit(rejected); } catch (_cause) { publish(rejected); }
    },
  };
}
