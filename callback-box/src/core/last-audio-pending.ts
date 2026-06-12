/**
 * Pending last-audio requests — the rendezvous between a CLI long-poll
 * (`cb chat get-last-audio` → POST /api/chat/last-audio/request) and the
 * browser tab(s) answering it.
 *
 * Lifecycle of one request: `create()` parks a promise under a request id;
 * the route broadcasts that id to connected chat tabs; each tab answers with
 * either its cached recording (`fulfill`) or "I have nothing" (`reportNone`).
 * The first audio answer wins. A "none" answer doesn't settle immediately —
 * another tab may still hold the recording — it starts a short grace window
 * and only resolves `none` when no audio arrives within it. If nothing
 * answers at all, the request times out (`timeout` = no client connected).
 */

import { randomUUID } from "node:crypto";

export interface LastAudioFulfillment {
  audio: Buffer;
  contentType: string;
  /** ISO timestamp the browser recorded the segment, if it sent one. */
  recordedAt: string | null;
  /** Snippet of the transcribed message the audio belongs to, if sent. */
  text: string | null;
}

export type LastAudioOutcome =
  | { status: "audio"; fulfillment: LastAudioFulfillment }
  | { status: "none" }
  | { status: "timeout" };

interface PendingEntry {
  resolve: (outcome: LastAudioOutcome) => void;
  timeoutTimer: NodeJS.Timeout;
  graceTimer: NodeJS.Timeout | null;
}

export interface LastAudioPending {
  /** Park a new request; `outcome` resolves on answer or timeout. */
  create(opts: { timeoutMs: number; requestId?: string | undefined }): {
    requestId: string;
    outcome: Promise<LastAudioOutcome>;
  };
  /** Deliver audio. False when the id is unknown or already settled. */
  fulfill(requestId: string, fulfillment: LastAudioFulfillment): boolean;
  /** A client answered "no audio cached". False when the id is unknown. */
  reportNone(requestId: string): boolean;
  /** Unsettled request count (observability + tests). */
  size(): number;
}

interface CreateLastAudioPendingOptions {
  /**
   * After a "none" answer, how long to keep waiting for an audio answer from
   * another tab before resolving `none`.
   */
  graceMs?: number;
}

const DEFAULT_GRACE_MS = 2000;

export function createLastAudioPending(options?: CreateLastAudioPendingOptions): LastAudioPending {
  const graceMs = options?.graceMs ?? DEFAULT_GRACE_MS;
  const pending = new Map<string, PendingEntry>();

  function settle(requestId: string, outcome: LastAudioOutcome): boolean {
    const entry = pending.get(requestId);
    if (entry === undefined) return false;
    pending.delete(requestId);
    clearTimeout(entry.timeoutTimer);
    if (entry.graceTimer !== null) clearTimeout(entry.graceTimer);
    entry.resolve(outcome);
    return true;
  }

  return {
    create({ timeoutMs, requestId }) {
      const id = requestId ?? randomUUID();
      let resolve!: (outcome: LastAudioOutcome) => void;
      const outcome = new Promise<LastAudioOutcome>((r) => {
        resolve = r;
      });
      const timeoutTimer = setTimeout(() => settle(id, { status: "timeout" }), timeoutMs);
      pending.set(id, { resolve, timeoutTimer, graceTimer: null });
      return { requestId: id, outcome };
    },
    fulfill(requestId, fulfillment) {
      return settle(requestId, { status: "audio", fulfillment });
    },
    reportNone(requestId) {
      const entry = pending.get(requestId);
      if (entry === undefined) return false;
      if (entry.graceTimer === null) {
        // A client did answer, so the full no-client timeout no longer
        // applies — the grace window is the only clock from here.
        clearTimeout(entry.timeoutTimer);
        entry.graceTimer = setTimeout(() => settle(requestId, { status: "none" }), graceMs);
      }
      return true;
    },
    size() {
      return pending.size;
    },
  };
}
