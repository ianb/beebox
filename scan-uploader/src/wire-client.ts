/**
 * The client half of the scan-upload wire contract.
 *
 * // WIRE CONTRACT (scan-upload): must match docs/scan-upload-contract.md — change both sides together.
 *
 * Every request shape, header, status vocabulary, and response parse in this
 * file mirrors that document exactly. Change both sides together.
 */

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { basename } from "node:path";

import { errorMessage } from "./error-guards.js";
import { ProtocolError, TransportError } from "./errors.js";
import { isRecord } from "./is-record.js";

export interface ServerConnection {
  readonly serverUrl: string;
  readonly box: string;
  readonly token: string;
}

/** Per-hash state map returned by `POST /api/scan/check`. */
export type CheckState = "unknown" | "pending" | "imported" | "rejected";

export interface CheckResult {
  readonly state: CheckState;
  readonly reason?: string;
}

/** Per-hash entries accepted by one `checkHashes` call. The server caps this at 500. */
export const CHECK_BATCH_LIMIT = 500;

// WIRE CONTRACT (scan-upload): must match docs/scan-upload-contract.md — change both sides together.
export async function checkHashes(
  connection: ServerConnection,
  hashes: readonly string[],
): Promise<Map<string, CheckResult>> {
  const url = checkUrl(connection);
  const response = await sendRequest(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${connection.token}`,
    },
    body: JSON.stringify({ hashes }),
  });
  if (response.status !== 200) {
    const message = await describeUnexpectedResponse(response, `check returned HTTP ${String(response.status)}`);
    throw new ProtocolError(url, message);
  }
  const body: unknown = await response.json();
  if (!isRecord(body) || !isRecord(body.states)) {
    throw new ProtocolError(url, "check response missing a states object");
  }
  const result = new Map<string, CheckResult>();
  for (const [hash, value] of Object.entries(body.states)) {
    result.set(hash, parseCheckResult(url, value));
  }
  return result;
}

/** The resolved outcome of a PUT, after any rate-limit retries have been absorbed. */
export type PutResult =
  | { readonly status: "accepted" }
  | { readonly status: "duplicate" }
  | { readonly status: "rejected"; readonly reason: string }
  | { readonly status: "hash-mismatch" }
  | { readonly status: "too-large" }
  | { readonly status: "server-error"; readonly reason: string }
  | { readonly status: "rate-limited"; readonly retryAfterSeconds: number };

const DEFAULT_RETRY_AFTER_SECONDS = 5;

// WIRE CONTRACT (scan-upload): must match docs/scan-upload-contract.md — change both sides together.
export async function putFile(
  connection: ServerConnection,
  params: { hash: string; filePath: string },
): Promise<PutResult> {
  const url = putUrl(connection, params.hash);
  const stats = await stat(params.filePath);
  const response = await sendRequest(url, {
    method: "PUT",
    headers: {
      "content-type": "application/octet-stream",
      "content-length": String(stats.size),
      "x-upload-filename": basename(params.filePath),
      authorization: `Bearer ${connection.token}`,
    },
    duplex: "half",
    body: createReadStream(params.filePath),
  });
  return interpretPutResponse(url, response);
}

async function sendRequest(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (e) {
    throw new TransportError(url, e);
  }
}

function checkUrl(connection: ServerConnection): string {
  return `${trimTrailingSlash(connection.serverUrl)}/${connection.box}/api/scan/check`;
}

function putUrl(connection: ServerConnection, hash: string): string {
  return `${trimTrailingSlash(connection.serverUrl)}/${connection.box}/api/scan/files/${hash}`;
}

function trimTrailingSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

function parseCheckResult(url: string, value: unknown): CheckResult {
  if (!isRecord(value) || typeof value.state !== "string" || !isCheckState(value.state)) {
    throw new ProtocolError(url, `check response entry has an unrecognized state: ${errorMessage(value)}`);
  }
  if (typeof value.reason === "string") {
    return { state: value.state, reason: value.reason };
  }
  return { state: value.state };
}

function isCheckState(value: string): value is CheckState {
  return value === "unknown" || value === "pending" || value === "imported" || value === "rejected";
}

async function interpretPutResponse(url: string, response: Response): Promise<PutResult> {
  switch (response.status) {
    case 200:
      return interpretPutSuccess(url, await response.json());
    case 422:
      return interpretPutRejection(url, await response.json());
    case 413:
      return { status: "too-large" };
    case 429:
      return { status: "rate-limited", retryAfterSeconds: parseRetryAfter(response.headers.get("retry-after")) };
    case 503:
      return { status: "server-error", reason: await serverErrorReason(response) };
    default:
      throw new ProtocolError(
        url,
        await describeUnexpectedResponse(response, `unexpected HTTP status ${String(response.status)}`),
      );
  }
}

function interpretPutSuccess(url: string, body: unknown): PutResult {
  if (isRecord(body) && body.status === "accepted") return { status: "accepted" };
  if (isRecord(body) && body.status === "duplicate") return { status: "duplicate" };
  throw new ProtocolError(url, "unexpected 200 body on PUT");
}

function interpretPutRejection(url: string, body: unknown): PutResult {
  if (isRecord(body) && body.status === "rejected" && typeof body.reason === "string") {
    return { status: "rejected", reason: body.reason };
  }
  if (isRecord(body) && body.status === "hash-mismatch") {
    return { status: "hash-mismatch" };
  }
  throw new ProtocolError(url, "unexpected 422 body on PUT");
}

async function serverErrorReason(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (isRecord(body) && body.status === "server-error" && typeof body.reason === "string") {
      return body.reason;
    }
  } catch (_e) {
    // Non-JSON 503 body (a proxy error page, say) — the status alone is
    // meaningful; fall through to the generic reason.
  }
  return "server temporarily unable to validate this file";
}

/** Field names checked (in order — first hit wins) for a human-readable
 * explanation on a response this client has no specific handling for. Not
 * part of the wire contract proper — a best-effort diagnostic aid, since
 * the server's error middleware commonly attaches one of these. */
const REASON_FIELD_NAMES = ["reason", "message", "error"] as const;

/** Caps how much of a reason field gets appended, so a server that (say)
 * echoes a stack trace as `message` doesn't turn one CLI line into a wall
 * of text. */
const REASON_MAX_LENGTH = 200;

/**
 * Builds the error text for an HTTP response this client doesn't
 * specifically handle. If the body parses as JSON and carries a `reason`,
 * `message`, or `error` string field, it's appended to `baseMessage` — this
 * is what turns `check returned HTTP 503` into something that actually
 * explains itself, instead of sending the boxholder to curl the endpoint by
 * hand. A non-JSON or fieldless body leaves `baseMessage` exactly as given.
 * Consumes the response body — callers must not have read it already.
 */
async function describeUnexpectedResponse(response: Response, baseMessage: string): Promise<string> {
  const reason = await extractReason(response);
  if (reason === undefined) return baseMessage;
  return `${baseMessage} — server says: ${truncateReason(reason)}`;
}

async function extractReason(response: Response): Promise<string | undefined> {
  let body: unknown;
  try {
    body = await response.json();
  } catch (_e) {
    return undefined;
  }
  if (!isRecord(body)) return undefined;
  for (const field of REASON_FIELD_NAMES) {
    const value = body[field];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

function truncateReason(reason: string): string {
  if (reason.length <= REASON_MAX_LENGTH) return reason;
  return `${reason.slice(0, REASON_MAX_LENGTH)}…`;
}

function parseRetryAfter(header: string | null): number {
  if (header === null) return DEFAULT_RETRY_AFTER_SECONDS;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds;
  return DEFAULT_RETRY_AFTER_SECONDS;
}
