/**
 * Chat reservations — a chat id that exists before the chat does.
 *
 * A new chat used to have no identity until the harness assigned one part-way
 * through its first run, so anything that wanted to put something into that
 * chat (a capture, a bulk upload, a second quick send) had to either wait or
 * create a session of its own — and two paths that both created ended up with
 * two chats. A reservation closes that window: the client coins a UUID, the box
 * reserves it, and the harness is told to use exactly that id
 * (`ChatBackendStartOptions.coinedSessionId`).
 *
 * A reservation is a *record*, deliberately not a registry entry. The registry
 * sweeps idle entries after ten minutes, and a chat the user opened, left, and
 * came back to with photos must still be addressable — sweeping stops the
 * subprocess, it does not cancel the reservation. The record also carries the
 * two pieces of context that used to ride the `"new"` send and would otherwise
 * be lost: the landmark binding and the pre-session feature seeds.
 *
 * Reservations are in-memory only. A server restart forgets them, which is
 * visible and recoverable: the client's next bootstrap re-reserves the same id
 * (reserving is idempotent, and an id with no transcript is never `taken`).
 * Persisting them would mean durable state for chats that may never exist.
 */

import { loadHistoryEntries } from "./history.js";
import { transcriptExistsForContext } from "./transcript-paths.js";
import { loadAgentEngine, type AgentEngine } from "../../box/config.js";

/** How long an unused reservation stays addressable. */
export const RESERVATION_TTL_MS = 6 * 60 * 60 * 1000;

/** A coined id the box has accepted, with the context its first run needs. */
export interface ChatReservation {
  sessionId: string;
  /**
   * Pinned here, not resolved later: `resolveChatEngine` answers `"claude"`
   * for any id it has no history entry for, and a reserved chat has no history
   * entry until its first turn — so a Codex box would silently route a coined
   * id to Claude.
   */
  engine: AgentEngine;
  /** Landmark binding captured at reserve time, or null for a root chat. */
  contextDir: string | null;
  /** Pre-session chat-feature choices (landmark defaults, narration, …). */
  seedFeatures: Record<string, string>;
  createdAt: number;
}

export type ReserveResult =
  | { kind: "reserved"; sessionId: string }
  /** The id already names a real chat — the client coins a different one. */
  | { kind: "taken" }
  /** This box's engine cannot be told an id; the caller uses the "new" path. */
  | { kind: "unsupported" };

/** UUID shape the harness requires of a coined id (any version). */
const UUID_RE = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i;

export function isCoinedIdShape(sessionId: string): boolean {
  return UUID_RE.test(sessionId);
}

/**
 * Live reservations for one box. Held by the registry, which owns the clock
 * and the sweep that expires them.
 */
export class ChatReservationStore {
  private readonly records = new Map<string, ChatReservation>();

  constructor(private readonly now: () => number) {}

  get(sessionId: string): ChatReservation | null {
    const record = this.records.get(sessionId);
    if (record === undefined) return null;
    if (this.now() - record.createdAt > RESERVATION_TTL_MS) {
      this.records.delete(sessionId);
      return null;
    }
    return record;
  }

  has(sessionId: string): boolean {
    return this.get(sessionId) !== null;
  }

  set(record: Omit<ChatReservation, "createdAt">): ChatReservation {
    const existing = this.get(record.sessionId);
    // Idempotent by id: a retried request or a StrictMode double-invoke must
    // reserve the same chat, not refresh it into a different one.
    if (existing !== null) return existing;
    const stored: ChatReservation = { ...record, createdAt: this.now() };
    this.records.set(record.sessionId, stored);
    return stored;
  }

  /**
   * Drop a reservation whose chat is now real (its first turn ran, so history
   * and a transcript answer for it) — or that the caller is abandoning.
   */
  release(sessionId: string): void {
    this.records.delete(sessionId);
  }

  /** Expire reservations past their TTL. Called from the registry's sweep. */
  sweepExpired(): void {
    const cutoff = this.now() - RESERVATION_TTL_MS;
    for (const [id, record] of this.records) {
      if (record.createdAt <= cutoff) this.records.delete(id);
    }
  }

  size(): number {
    return this.records.size;
  }

  /** Reserved ids, newest first — the per-chat prewarm's candidate list. */
  ids(): string[] {
    return [...this.records.values()]
      .toSorted((a, b) => b.createdAt - a.createdAt)
      .map((record) => record.sessionId);
  }
}

/**
 * Whether this id already names a real chat. Deliberately *not*
 * `isResumableSession`: that answers from `loadAllSessions`, which requires a
 * husk card AND a transcript, so it would also report "no" for a chat whose
 * first turn is mid-flight — and a coined id must never be handed to a harness
 * that would reject it as already in use.
 */
async function chatIdIsTaken(
  boxRoot: string,
  opts: { sessionId: string; contextDir: string | null },
): Promise<boolean> {
  const entries = await loadHistoryEntries(boxRoot);
  if (entries.some((entry) => entry.id === opts.sessionId)) return true;
  return transcriptExistsForContext(boxRoot, opts);
}

/**
 * Accept a client-coined chat id, or say why not. Idempotent: reserving an id
 * this box already holds returns `reserved` again with the original record.
 */
export async function reserveChatSession(opts: {
  boxRoot: string;
  store: ChatReservationStore;
  sessionId: string;
  contextDir: string | null;
  seedFeatures: Record<string, string>;
}): Promise<ReserveResult> {
  const { boxRoot, store, sessionId, contextDir, seedFeatures } = opts;
  if (!isCoinedIdShape(sessionId)) return { kind: "taken" };
  if (store.has(sessionId)) return { kind: "reserved", sessionId };
  const engine = await loadAgentEngine(boxRoot);
  if (engine !== "claude") return { kind: "unsupported" };
  if (await chatIdIsTaken(boxRoot, { sessionId, contextDir })) return { kind: "taken" };
  store.set({ sessionId, engine, contextDir, seedFeatures });
  return { kind: "reserved", sessionId };
}
