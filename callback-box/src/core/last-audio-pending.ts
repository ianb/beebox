/**
 * Pending last-audio requests — the rendezvous between a CLI long-poll
 * (`cb chat get-last-audio` → POST /api/chat/last-audio/request) and the
 * browser tab(s) answering it.
 *
 * This is a thin specialization of the generic
 * {@link createPendingBrowserRequests} primitive: last-audio never uses the
 * ack phase, so its outcomes are only `audio` (a `fulfill`), `none` (a
 * `reportNone` that outlasts the grace window), and `timeout` (nothing
 * answered — the route maps this to "no client connected"). The generic
 * `fulfilled` status is renamed `audio` here so existing callers and the
 * doctest keep their `status === "audio"` / `result.fulfillment.audio` shape.
 */

import {
  createPendingBrowserRequests,
  type PendingOutcome,
} from "./pending-browser-request.js";
import { invariant } from "../lib/invariant.js";

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

export interface LastAudioPending {
  /**
   * Park a new request; `outcome` resolves on answer or timeout. The id is
   * generated internally and returned — never caller-supplied (see
   * {@link createPendingBrowserRequests}).
   */
  create(opts: { timeoutMs: number }): {
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

/** Map the generic outcome onto last-audio's `audio`/`none`/`timeout` shape. */
function toLastAudioOutcome(outcome: PendingOutcome<LastAudioFulfillment>): LastAudioOutcome {
  switch (outcome.status) {
    case "fulfilled":
      return { status: "audio", fulfillment: outcome.fulfillment };
    case "none":
      return { status: "none" };
    case "timeout":
      return { status: "timeout" };
    case "no-client":
      // last-audio never passes `ackGraceMs`, so there is no ack phase and
      // this branch is unreachable.
      invariant(false, "last-audio has no ack phase; no-client is impossible");
  }
}

export function createLastAudioPending(options?: CreateLastAudioPendingOptions): LastAudioPending {
  const inner = createPendingBrowserRequests<LastAudioFulfillment>(
    options?.graceMs === undefined ? undefined : { graceMs: options.graceMs }
  );
  return {
    create({ timeoutMs }) {
      const { requestId: id, outcome } = inner.create({ timeoutMs });
      return { requestId: id, outcome: outcome.then(toLastAudioOutcome) };
    },
    fulfill(requestId, fulfillment) {
      return inner.fulfill(requestId, fulfillment);
    },
    reportNone(requestId) {
      return inner.reportNone(requestId);
    },
    size() {
      return inner.size();
    },
  };
}
