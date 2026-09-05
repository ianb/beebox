/**
 * The message-id claim registry behind `POST /api/chat/send` — how a retried
 * send is recognized as one the box already has.
 *
 * There are two claims on a message id, deliberately different in kind:
 *
 *  - the DURABLE claim (`processedMessageIds`, persisted to
 *    `.beebox/message-dedup.json`), written at the same moment as the
 *    persisted user message. It alone answers `deduplicated: true` — "the box
 *    has this message" — because it alone survives a crash.
 *  - the VOLATILE claim, held only for the life of the request that took it:
 *    the in-flight double-submit guard. A duplicate arriving in that window
 *    cannot be told `deduplicated: true` (the first request may still die
 *    before recording anything, leaving its client believing a send that never
 *    landed), so it waits for the first request's real outcome and answers with
 *    it — the server-side mirror of the frontend's shared receipt expectations
 *    (`src/frontend/src/input/targets/receipts.ts`).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { isRecord } from "../../lib/is-record.js";

const MESSAGE_ID_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/** The status + body one `/api/chat/send` request answers with. */
export interface SendOutcome {
  status: number;
  body: { deduplicated: true } | { queued: true } | { turnId: string } | { error: string };
}

export interface InFlightSends {
  /**
   * Claim `messageId` for a request that is about to run. The returned settle
   * function MUST be called on every exit from that request — an unsettled
   * claim leaves every duplicate POST for the id waiting until its client
   * gives up.
   */
  begin(messageId: string): (outcome: SendOutcome) => void;
  /**
   * The outcome of the request currently holding `messageId`, or null when no
   * request is in flight for it (so the durable claim decides).
   */
  pending(messageId: string): Promise<SendOutcome> | null;
}

export function createInFlightSends(): InFlightSends {
  // A claim is its list of waiters — the duplicates parked on this id. Holding
  // the resolvers (rather than one shared promise) keeps the claim cheap when
  // nothing duplicates it, which is the overwhelmingly common case.
  const inFlight = new Map<string, ((outcome: SendOutcome) => void)[]>();

  const sends: InFlightSends = {
    begin(messageId: string) {
      const waiters: ((outcome: SendOutcome) => void)[] = [];
      inFlight.set(messageId, waiters);
      return (outcome: SendOutcome) => {
        // Drop the claim before resolving: a waiter that re-enters the route
        // (a third POST for the same id) must not find a settled claim still
        // registered as in flight.
        inFlight.delete(messageId);
        for (const waiter of waiters.splice(0)) waiter(outcome);
      };
    },
    pending(messageId: string) {
      const waiters = inFlight.get(messageId);
      if (waiters === undefined) return null;
      return new Promise<SendOutcome>((resolve) => {
        waiters.push(resolve);
      });
    },
  };
  return sends;
}

function dedupStatePath(boxRoot: string): string {
  return path.join(boxRoot, ".beebox", "message-dedup.json");
}

/**
 * Hydrate the durable claims from disk so a server restart between a
 * successful send and the client's retry still suppresses the duplicate.
 * Expired entries (older than the TTL) are dropped on load.
 */
export function loadProcessedMessageIds(boxRoot: string): Map<string, number> {
  const map = new Map<string, number>();
  try {
    const obj: unknown = JSON.parse(fs.readFileSync(dedupStatePath(boxRoot), "utf-8"));
    const cutoff = Date.now() - MESSAGE_ID_TTL_MS;
    if (isRecord(obj)) {
      for (const [id, ts] of Object.entries(obj)) {
        if (typeof ts === "number" && ts >= cutoff) map.set(id, ts);
      }
    }
  } catch (_e) {
    // No prior dedup file (fresh box / first run) — start empty.
  }
  return map;
}

/**
 * Take the durable claim on `messageId`. Called at the one durability point —
 * beside the persisted user message — so a crash loses the claim and the
 * message together, never one without the other.
 */
export function recordDurableClaim(
  boxRoot: string,
  { messageId, processedMessageIds }: { messageId: string; processedMessageIds: Map<string, number> },
): void {
  processedMessageIds.set(messageId, Date.now());
  try {
    const obj: Record<string, number> = {};
    for (const [id, ts] of processedMessageIds) obj[id] = ts;
    const file = dedupStatePath(boxRoot);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(obj));
  } catch (e) {
    console.error("[chat] failed to persist message-dedup state:", e);
  }
}

/**
 * Either this send is a duplicate — answered by the in-flight request's shared
 * outcome, or by `deduplicated: true` from a durable claim — or it takes the
 * volatile claim and runs.
 */
export type MessageClaim =
  | { kind: "duplicate"; outcome: SendOutcome | Promise<SendOutcome> }
  | { kind: "claimed"; settle: (outcome: SendOutcome) => void };

/**
 * Synchronous on purpose: checking the claims and taking one must not be
 * separated by an await, or two concurrent sends of the same id both pass the
 * check and both run.
 */
export function claimMessageId({
  messageId,
  processedMessageIds,
  inFlightSends,
}: {
  messageId: string;
  processedMessageIds: Map<string, number>;
  inFlightSends: InFlightSends;
}): MessageClaim {
  const cutoff = Date.now() - MESSAGE_ID_TTL_MS;
  for (const [id, ts] of processedMessageIds) {
    if (ts < cutoff) processedMessageIds.delete(id);
  }
  const inFlight = inFlightSends.pending(messageId);
  if (inFlight !== null) {
    // debug, not log: duplicates are ROUTINE once clients redeliver on
    // navigation and backoff (emission-model plan) — this must not spam.
    console.debug(`[chat] Duplicate message ${messageId} arrived in flight, sharing its outcome`);
    return { kind: "duplicate", outcome: inFlight };
  }
  if (processedMessageIds.has(messageId)) {
    console.debug(`[chat] Duplicate message ${messageId}, skipping`);
    return { kind: "duplicate", outcome: { status: 200, body: { deduplicated: true } } };
  }
  return { kind: "claimed", settle: inFlightSends.begin(messageId) };
}
