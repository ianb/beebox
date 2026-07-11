/**
 * Pending browser-request rendezvous — the generic primitive behind
 * CLI-long-poll → browser-tab round-trips.
 *
 * One request's lifecycle: `create()` parks a promise under a request id; a
 * route broadcasts that id to connected browser tabs; a tab answers by
 * delivering a payload (`fulfill`, first-wins) or by reporting "I have
 * nothing" (`reportNone`, which starts a short grace window in case another
 * tab still holds an answer). Silence times out.
 *
 * Two-phase (ack) variant: when a request is created with `ackGraceMs`, a tab
 * that received the request and matched it POSTs an `ack()` first. If no ack
 * arrives within `ackGraceMs` the request resolves `no-client` — nothing was
 * listening (tab closed, event dropped, stale frontend, user on mobile). Once
 * acked, only `fulfill`/`reportNone`/timeout apply, so an acked-but-unanswered
 * request resolves `timeout` (a client saw it but never answered), keeping the
 * two failures honestly distinct. Without `ackGraceMs` there is no ack phase
 * and `no-client` can never occur — that is the last-audio behavior.
 *
 * The fulfillment payload is a type parameter, so consumers carry whatever
 * answer shape they need (audio bytes, an image, or a small union that
 * includes a consumer-level "declined" variant — decline is not a primitive
 * concept, it is just another fulfillment payload).
 */

import { randomUUID } from "node:crypto";

export type PendingOutcome<TFulfillment> =
  | { status: "fulfilled"; fulfillment: TFulfillment }
  | { status: "none" }
  | { status: "timeout" }
  | { status: "no-client" };

interface PendingEntry<TFulfillment> {
  resolve: (outcome: PendingOutcome<TFulfillment>) => void;
  /** Overall clock: fires `timeout` when nothing settles the request. */
  timeoutTimer: NodeJS.Timeout;
  /** Started by `reportNone`; fires `none` when no answer beats the grace. */
  graceTimer: NodeJS.Timeout | null;
  /** Started at create when `ackGraceMs` is set; fires `no-client` if no ack. */
  ackTimer: NodeJS.Timeout | null;
}

export interface PendingBrowserRequests<TFulfillment> {
  /** Park a new request; `outcome` resolves on answer, ack-timeout, or timeout. */
  create(opts: {
    timeoutMs: number;
    requestId?: string | undefined;
    ackGraceMs?: number | undefined;
  }): { requestId: string; outcome: Promise<PendingOutcome<TFulfillment>> };
  /**
   * A client received the request and is handling it. Cancels the ack window
   * so the request no longer resolves `no-client`. Idempotent. False when the
   * id is unknown or already settled.
   */
  ack(requestId: string): boolean;
  /** Deliver a payload (first-wins). False when the id is unknown or settled. */
  fulfill(requestId: string, fulfillment: TFulfillment): boolean;
  /** A client answered "nothing here". False when the id is unknown or settled. */
  reportNone(requestId: string): boolean;
  /** Unsettled request count (observability + tests). */
  size(): number;
}

interface CreatePendingBrowserRequestsOptions {
  /**
   * After a `reportNone` answer, how long to keep waiting for a real answer
   * from another tab before resolving `none`.
   */
  graceMs: number;
}

const DEFAULT_GRACE_MS = 2000;

export function createPendingBrowserRequests<TFulfillment>(
  options?: Partial<CreatePendingBrowserRequestsOptions>
): PendingBrowserRequests<TFulfillment> {
  const graceMs = options?.graceMs ?? DEFAULT_GRACE_MS;
  const pending = new Map<string, PendingEntry<TFulfillment>>();

  function settle(requestId: string, outcome: PendingOutcome<TFulfillment>): boolean {
    const entry = pending.get(requestId);
    if (entry === undefined) return false;
    pending.delete(requestId);
    clearTimeout(entry.timeoutTimer);
    if (entry.graceTimer !== null) clearTimeout(entry.graceTimer);
    if (entry.ackTimer !== null) clearTimeout(entry.ackTimer);
    entry.resolve(outcome);
    return true;
  }

  return {
    create({ timeoutMs, requestId, ackGraceMs }) {
      const id = requestId ?? randomUUID();
      let resolve!: (outcome: PendingOutcome<TFulfillment>) => void;
      const outcome = new Promise<PendingOutcome<TFulfillment>>((r) => {
        resolve = r;
      });
      const timeoutTimer = setTimeout(() => settle(id, { status: "timeout" }), timeoutMs);
      const ackTimer =
        ackGraceMs === undefined
          ? null
          : setTimeout(() => settle(id, { status: "no-client" }), ackGraceMs);
      pending.set(id, { resolve, timeoutTimer, graceTimer: null, ackTimer });
      return { requestId: id, outcome };
    },
    ack(requestId) {
      const entry = pending.get(requestId);
      if (entry === undefined) return false;
      if (entry.ackTimer !== null) {
        clearTimeout(entry.ackTimer);
        entry.ackTimer = null;
      }
      return true;
    },
    fulfill(requestId, fulfillment) {
      return settle(requestId, { status: "fulfilled", fulfillment });
    },
    reportNone(requestId) {
      const entry = pending.get(requestId);
      if (entry === undefined) return false;
      // A client answered, so neither the no-client ack window nor the full
      // timeout applies anymore — the grace window is the only clock from here.
      if (entry.ackTimer !== null) {
        clearTimeout(entry.ackTimer);
        entry.ackTimer = null;
      }
      if (entry.graceTimer === null) {
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
