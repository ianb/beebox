/**
 * Push service — typed interface for sending one Web Push message.
 *
 * Real implementation wraps the `web-push` library (VAPID + encryption).
 * Fake implementation records every send and can be told which endpoints
 * are "gone" (expired/unsubscribed), so tests and the BBX_PUSH_FAKE dev mode
 * exercise the prune path without a real push service.
 *
 * A send resolves to a discriminated result rather than throwing for the
 * expected "endpoint is dead" case (404/410) — the caller prunes on `gone`.
 * Genuinely transient failures (429/5xx, network) throw, so the caller can
 * surface them (e.g. stamp an output card `failed`). See
 * docs/plans/web-push-notifications.md (Track B).
 */

import webpush from "web-push";
import { isRecord } from "../lib/is-record.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PushSubscriptionKeys {
  p256dh: string;
  auth: string;
}

/** The stored shape of a browser PushSubscription (endpoint + keys). */
export interface StoredPushSubscription {
  endpoint: string;
  keys: PushSubscriptionKeys;
}

/** The notification payload delivered to the service worker's `push` handler. */
export interface PushPayload {
  title: string;
  body: string;
  /** Root-relative deep link opened on notificationclick (e.g. "/box/browse/x"). */
  url: string;
  tag?: string | undefined;
  /**
   * Root-relative icon for the notification. `sendPush` fills this in with the
   * sending box's own mark, so a notification says which box is talking — the
   * one surface where a box is identified with no other context on screen.
   * Callers may set it to override; the service worker falls back to the
   * shared app icon when it is absent.
   */
  icon?: string | undefined;
}

/** A send either delivered or the endpoint is gone and should be pruned. */
export type PushSendResult = { delivered: true } | { gone: true };

export interface PushService {
  send(subscription: StoredPushSubscription, payload: PushPayload): Promise<PushSendResult>;
}

export interface VapidConfig {
  publicKey: string;
  privateKey: string;
  /** Contact URI for the push service, e.g. "mailto:ops@example.com". */
  subject: string;
}

// ─── Real implementation ─────────────────────────────────────────────────────

/** Status codes that mean the subscription is permanently dead. */
const GONE_STATUS = new Set([404, 410]);

export function createPushService(vapid: VapidConfig): PushService {
  webpush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);
  return {
    async send(subscription, payload) {
      try {
        await webpush.sendNotification(
          { endpoint: subscription.endpoint, keys: subscription.keys },
          JSON.stringify(payload),
        );
        return { delivered: true };
      } catch (e) {
        const statusCode = isRecord(e) && typeof e["statusCode"] === "number" ? e["statusCode"] : undefined;
        if (statusCode !== undefined && GONE_STATUS.has(statusCode)) {
          return { gone: true };
        }
        throw e;
      }
    },
  };
}

// ─── Fake implementation ─────────────────────────────────────────────────────

export interface FakePushOptions {
  /** Endpoints that should resolve to `{ gone: true }` instead of delivering. */
  goneEndpoints?: string[];
  /** Endpoints whose send should throw (simulating a transient 5xx). */
  failEndpoints?: string[];
}

export interface FakeSentPush {
  endpoint: string;
  payload: PushPayload;
}

/** Thrown by the fake to simulate a transient (non-gone) send failure. */
class FakePushTransientError extends Error {
  readonly endpoint: string;
  constructor(endpoint: string) {
    super("fake transient push failure");
    this.name = "FakePushTransientError";
    this.endpoint = endpoint;
  }
}

export interface FakePushService extends PushService {
  /** Every successful (delivered) send, in order. */
  sent: FakeSentPush[];
  describe(): string;
}

export function createFakePush(opts?: FakePushOptions): FakePushService {
  const gone = new Set(opts?.goneEndpoints);
  const fail = new Set(opts?.failEndpoints);

  const fake: FakePushService = {
    sent: [],

    async send(subscription, payload) {
      if (fail.has(subscription.endpoint)) {
        throw new FakePushTransientError(subscription.endpoint);
      }
      if (gone.has(subscription.endpoint)) {
        return { gone: true };
      }
      fake.sent.push({ endpoint: subscription.endpoint, payload });
      return { delivered: true };
    },

    describe() {
      if (fake.sent.length === 0) return "FakePush: nothing sent";
      return [
        `FakePush: ${fake.sent.length} sent`,
        ...fake.sent.map((s) => `  ${s.endpoint} → ${s.payload.title}: ${s.payload.body}`),
      ].join("\n");
    },
  };

  return fake;
}
