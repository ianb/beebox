/**
 * APNs service — typed interface for sending one push to one iPhone.
 *
 * The real implementation wraps `@parse/node-apn` with token (`.p8`) auth over
 * HTTP/2, one provider per environment: a sandbox token (a debug build) sent to
 * the production host is rejected as `BadDeviceToken`, so every device reports
 * which environment its build was signed for and the send goes to that host.
 * The fake records every send and can be told which tokens are gone or fail.
 *
 * A send resolves `{ ok }` or `{ gone }` for the expected "this token is dead"
 * answers (410 Unregistered, 400 BadDeviceToken); the caller prunes on `gone`.
 * Anything else throws. A token is never put in an error message or a log line.
 * See docs/implemented-plans/notifications.md (Track B).
 */

import { createHash } from "node:crypto";
import { Notification, Provider } from "@parse/node-apn";
import { isRecord } from "../shared/is-record.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export const APNS_ENVIRONMENTS = ["sandbox", "production"] as const;
/** Which APNs host a device token belongs to: the build's signing environment. */
export type ApnsEnvironment = (typeof APNS_ENVIRONMENTS)[number];

/** The request headers a send sets. `apns-topic` is the app's bundle id. */
export interface ApnsHeaders {
  "apns-push-type": "alert";
  "apns-topic": string;
  /** A later notification with the same collapse id replaces an earlier one on the phone. */
  "apns-collapse-id"?: string | undefined;
}

export interface ApnsSendRequest {
  token: string;
  environment: ApnsEnvironment;
  /** The JSON body: `aps` plus the custom keys the iOS client reads. */
  payload: Record<string, unknown>;
  headers: ApnsHeaders;
}

/** Delivered, or the token is dead and the device's registration should be pruned. */
export type ApnsSendResult = { ok: true } | { gone: true; reason: string };

export interface ApnsService {
  send(request: ApnsSendRequest): Promise<ApnsSendResult>;
  /** Close any open connection so a short-lived process can exit. */
  close(): Promise<void>;
}

export interface ApnsConfig {
  /** Path to the `.p8` signing key Apple issued. */
  keyPath: string;
  keyId: string;
  teamId: string;
  bundleId: string;
}

// ─── Real implementation ─────────────────────────────────────────────────────

/** Thrown when APNs refuses a send for a reason other than a dead token. */
export class ApnsSendError extends Error {
  readonly status: number | undefined;
  readonly reason: string | undefined;
  constructor(opts: { status: number | undefined; reason: string | undefined; cause?: unknown }) {
    super(`APNs refused the push (${opts.status ?? "no status"}${opts.reason === undefined ? "" : ` ${opts.reason}`})`, {
      cause: opts.cause,
    });
    this.name = "ApnsSendError";
    this.status = opts.status;
    this.reason = opts.reason;
  }
}

/**
 * Turn one failure as `@parse/node-apn` reports it — `{ device, status?,
 * response?: { reason }, error? }` — into a result or an error. 410
 * Unregistered and 400 BadDeviceToken both mean the token will never work
 * again: `gone`. Everything else is an {@link ApnsSendError}.
 */
export function classifyApnsFailure(failure: unknown): { gone: true; reason: string } | ApnsSendError {
  const record = isRecord(failure) ? failure : {};
  const status = typeof record["status"] === "number" ? record["status"] : undefined;
  const response = record["response"];
  const reason = isRecord(response) && typeof response["reason"] === "string" ? response["reason"] : undefined;
  if (status === 410) return { gone: true, reason: reason ?? "Unregistered" };
  if (status === 400 && reason === "BadDeviceToken") return { gone: true, reason };
  const error = isRecord(failure) ? failure["error"] : failure;
  return new ApnsSendError({ status, reason: reason ?? (error instanceof Error ? error.message : undefined), cause: error });
}

export function createApnsService(config: ApnsConfig): ApnsService {
  const providers = new Map<ApnsEnvironment, Provider>();

  function provider(environment: ApnsEnvironment): Provider {
    const existing = providers.get(environment);
    if (existing !== undefined) return existing;
    const created = new Provider({
      token: { key: config.keyPath, keyId: config.keyId, teamId: config.teamId },
      production: environment === "production",
    });
    providers.set(environment, created);
    return created;
  }

  return {
    async send(request) {
      const notification = new Notification();
      notification.rawPayload = request.payload;
      notification.topic = request.headers["apns-topic"];
      notification.pushType = request.headers["apns-push-type"];
      const collapseId = request.headers["apns-collapse-id"];
      if (collapseId !== undefined) notification.collapseId = collapseId;

      const result = await provider(request.environment).send(notification, request.token);
      if (result.sent.length > 0) return { ok: true };
      const failure = classifyApnsFailure(result.failed[0]);
      if (failure instanceof ApnsSendError) throw failure;
      return failure;
    },

    async close() {
      const open = [...providers.values()];
      providers.clear();
      await Promise.allSettled(open.map((p) => p.shutdown()));
    },
  };
}

// ─── Fake implementation ─────────────────────────────────────────────────────

export interface FakeApnsOptions {
  /** Tokens whose send resolves `{ gone }` (410 Unregistered). */
  goneTokens?: string[] | undefined;
  /** Tokens whose send throws, as a 5xx or a dropped connection would. */
  failTokens?: string[] | undefined;
}

/** Thrown by the fake to simulate a transient send failure. */
class FakeApnsTransientError extends Error {
  constructor() {
    super("fake transient APNs failure");
    this.name = "FakeApnsTransientError";
  }
}

export interface FakeApnsService extends ApnsService {
  /** Every delivered send, in order. */
  sent: ApnsSendRequest[];
  /** How many times `close` was called. */
  closed: number;
  describe(): string;
}

/** The first 8 hex digits of a token's SHA-256: enough to tell devices apart, useless as a token. */
function tokenFingerprint(token: string): string {
  return createHash("sha256").update(token).digest("hex").slice(0, 8);
}

export function createFakeApns(opts?: FakeApnsOptions): FakeApnsService {
  const gone = new Set(opts?.goneTokens);
  const fail = new Set(opts?.failTokens);

  const fake: FakeApnsService = {
    sent: [],
    closed: 0,

    async send(request) {
      if (fail.has(request.token)) throw new FakeApnsTransientError();
      if (gone.has(request.token)) return { gone: true, reason: "Unregistered" };
      fake.sent.push(request);
      return { ok: true };
    },

    async close() {
      fake.closed++;
    },

    describe() {
      if (fake.sent.length === 0) return "FakeApns: nothing sent";
      return [
        `FakeApns: ${fake.sent.length} sent`,
        // Never a token, fakes included: its short hash tells sends apart.
        ...fake.sent.map((s) => `  ${s.environment} token#${tokenFingerprint(s.token)} → ${JSON.stringify(s.payload)}`),
      ].join("\n");
    },
  };

  return fake;
}
