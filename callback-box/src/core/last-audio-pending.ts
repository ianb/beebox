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
 *
 * **Echo-and-verify** (retranscription-in-chat plan, Track 1b — load-bearing):
 * every request targets an exact `messageId` (there is no untargeted "latest"
 * mode). A tab's answer must echo that id back on {@link LastAudioFulfillment};
 * `fulfill()` checks it against the request's stored target and returns
 * `"ignored"` — WITHOUT settling the request — when the echoed id is absent
 * or mismatched. This is what stops a stale pre-1b tab (which still answers
 * with whatever it last retained and no identity attached) from winning a
 * targeted request with the wrong audio: an identity-less or mismatched
 * answer can only ever satisfy `{none:true}` bookkeeping via `reportNone`,
 * never deliver audio for a targeted request.
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
  /** The emission id the recording is retained under, if the tab sent one. */
  messageId: string | null;
  /** The answering tab's own chat session id, if it sent one. */
  sessionId: string | null;
}

export type LastAudioOutcome =
  | { status: "audio"; fulfillment: LastAudioFulfillment }
  | { status: "none" }
  | { status: "timeout" };

/**
 * The result of a fulfillment attempt: `"delivered"` settles the request;
 * `"ignored"` means the echoed `messageId` was absent or didn't match the
 * request's target (the request keeps waiting for a correct answer, or
 * times out — see the echo-and-verify note above); `"unknown"` means the
 * request id itself is unknown or already settled (same as today's 404).
 */
export type LastAudioFulfillOutcome = "delivered" | "ignored" | "unknown";

export interface LastAudioPending {
  /**
   * Park a new request targeting `messageId`; `outcome` resolves on a
   * correctly-targeted answer or timeout. The id is generated internally and
   * returned — never caller-supplied (see {@link createPendingBrowserRequests}).
   */
  create(opts: { timeoutMs: number; messageId: string }): {
    requestId: string;
    outcome: Promise<LastAudioOutcome>;
  };
  /**
   * Attempt to deliver audio. Settles the request only when
   * `fulfillment.messageId` matches the request's target — see
   * {@link LastAudioFulfillOutcome}.
   */
  fulfill(requestId: string, fulfillment: LastAudioFulfillment): LastAudioFulfillOutcome;
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
  // The requested messageId per unsettled request — the target a fulfillment
  // must echo. Cleaned up whenever the request settles (any status), via the
  // outcome promise itself, so it never outlives the request it targets.
  const targets = new Map<string, string>();
  return {
    create({ timeoutMs, messageId }) {
      const { requestId: id, outcome } = inner.create({ timeoutMs });
      targets.set(id, messageId);
      return {
        requestId: id,
        outcome: outcome.then((result) => {
          targets.delete(id);
          return toLastAudioOutcome(result);
        }),
      };
    },
    fulfill(requestId, fulfillment) {
      const target = targets.get(requestId);
      if (target === undefined) return "unknown";
      if (fulfillment.messageId !== target) return "ignored";
      return inner.fulfill(requestId, fulfillment) ? "delivered" : "unknown";
    },
    reportNone(requestId) {
      return inner.reportNone(requestId);
    },
    size() {
      return inner.size();
    },
  };
}
