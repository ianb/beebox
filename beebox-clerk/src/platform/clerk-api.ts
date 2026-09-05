/**
 * Thin client for the box-hosted clerk API — the `clerk` tRPC router
 * (beebox src/webapp/trpc/routers/clerk.ts), called over its plain
 * HTTP transport. Auth is the browser's own session cookie:
 * credentials:"include" plus the per-origin host permission granted when the
 * box was enabled.
 */

import type { EnabledBox } from "../domain/config.js";
import type {
  CommentaryPayload,
  CommentaryDestination,
  CommentaryResult,
  TabArrangementPayload,
  TabArrangementResult,
} from "../contract/clerk-contract.generated.js";
import { isRecord } from "../domain/is-record.js";

export class ClerkApiError extends Error {
  constructor(
    readonly status: number,
    options: { endpoint: string; detail: string },
  ) {
    super(`Clerk API ${options.endpoint} failed (${status === 0 ? "network" : status}): ${options.detail}`);
    this.name = "ClerkApiError";
  }
}

export function isAuthError(error: unknown): boolean {
  return error instanceof ClerkApiError && (error.status === 401 || error.status === 403);
}

async function fetchOrThrow(url: string, init: RequestInit): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, { credentials: "include", ...init });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    throw new ClerkApiError(0, { endpoint: url, detail });
  }
  if (!res.ok) {
    let detail = "";
    try {
      detail = (await res.text()).slice(0, 300);
    } catch (e) {
      detail = e instanceof Error ? e.message : String(e);
    }
    throw new ClerkApiError(res.status, { endpoint: url, detail });
  }
  return res;
}

/**
 * Read the `{ result: { data } }` tRPC success envelope off already-parsed JSON.
 * Pure and unit-tested: the extension and a deployed box can drift (the box is
 * updated independently), so we never ride a `res.json()` cast blindly into an
 * `undefined`. Returns the inner `data` or `{ ok: false }` for anything that
 * isn't the expected envelope.
 */
export function readEnvelopeData(body: unknown): { ok: true; data: unknown } | { ok: false } {
  if (!isRecord(body)) return { ok: false };
  const result = body["result"];
  if (!isRecord(result) || !("data" in result)) return { ok: false };
  return { ok: true, data: result["data"] };
}

/**
 * Parse + validate a tRPC success response. `shape` is the runtime twin of the
 * generated snapshot for the procedure — it hand-checks the minimal shape and
 * returns the typed value, or `null` when the response doesn't match (a
 * deployed box older/newer than this extension). A mismatch becomes a
 * `ClerkApiError` telling the user to reload or update the extension, never a
 * silent `undefined`.
 */
async function readTrpcData<T>(
  res: Response,
  { endpoint, shape }: { endpoint: string; shape: (data: unknown) => T | null },
): Promise<T> {
  let body: unknown;
  try {
    body = await res.json();
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    throw new ClerkApiError(res.status, {
      endpoint,
      detail: `malformed JSON response (${detail}) — reload the page or update the Clerk extension`,
    });
  }
  const envelope = readEnvelopeData(body);
  if (!envelope.ok) {
    throw new ClerkApiError(res.status, {
      endpoint,
      detail: "unexpected response envelope — reload the page or update the Clerk extension",
    });
  }
  const value = shape(envelope.data);
  if (value === null) {
    throw new ClerkApiError(res.status, {
      endpoint,
      detail: "unexpected response shape — reload the page or update the Clerk extension",
    });
  }
  return value;
}

/**
 * Call a tRPC query/mutation on the box (non-batched form). The clerk endpoints
 * moved from raw routes to the `clerk` tRPC router; the transport is otherwise
 * unchanged (credentialed cross-origin fetch via the box host permission).
 */
async function trpcQuery<T>(
  box: EnabledBox,
  { procedure, shape }: { procedure: string; shape: (data: unknown) => T | null },
): Promise<T> {
  const res = await fetchOrThrow(`${box.boxUrl}/api/trpc/${procedure}`, { method: "GET" });
  return readTrpcData(res, { endpoint: procedure, shape });
}

async function trpcMutation<T>(
  box: EnabledBox,
  { procedure, input, shape }: { procedure: string; input: unknown; shape: (data: unknown) => T | null },
): Promise<T> {
  const res = await fetchOrThrow(`${box.boxUrl}/api/trpc/${procedure}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return readTrpcData(res, { endpoint: procedure, shape });
}

/**
 * Runtime twin of the generated `CommentaryDestination` — narrows one raw
 * destination record to the typed shape without an `as` cast, or `null` if it
 * doesn't match. Kept in lockstep with clerk-contract.generated.ts by hand.
 */
function parseDestination(value: unknown): CommentaryDestination | null {
  if (!isRecord(value)) return null;
  const dir = value["dir"];
  const label = value["label"];
  const symbol = value["symbol"];
  if (typeof dir !== "string" || typeof label !== "string") return null;
  if (symbol !== null && typeof symbol !== "string") return null;
  return { dir, label, symbol };
}

/** Runtime twin of the `clerk.commentaryDestinations` output. */
export function parseDestinationsData(data: unknown): CommentaryDestination[] | null {
  if (!isRecord(data) || !Array.isArray(data["destinations"])) return null;
  const out: CommentaryDestination[] = [];
  for (const raw of data["destinations"]) {
    const dest = parseDestination(raw);
    if (dest === null) return null;
    out.push(dest);
  }
  return out;
}

/** Runtime twin of the generated `CommentaryResult`. */
export function parseCommentaryResult(data: unknown): CommentaryResult | null {
  if (!isRecord(data)) return null;
  const created = data["created"];
  const open = data["open"];
  if (!Array.isArray(created) || typeof open !== "string") return null;
  const paths: string[] = [];
  for (const p of created) {
    if (typeof p !== "string") return null;
    paths.push(p);
  }
  return { created: paths, open };
}

/** Runtime twin of the generated `TabArrangementResult`. */
export function parseTabArrangementResult(data: unknown): TabArrangementResult | null {
  if (!isRecord(data)) return null;
  const card = data["card"];
  const open = data["open"];
  const transferId = data["transferId"];
  if (typeof card !== "string" || typeof open !== "string" || typeof transferId !== "string") return null;
  return { card, open, transferId };
}

export async function getCommentaryDestinations(box: EnabledBox): Promise<CommentaryDestination[]> {
  return trpcQuery(box, { procedure: "clerk.commentaryDestinations", shape: parseDestinationsData });
}

export async function postCommentary(box: EnabledBox, payload: CommentaryPayload): Promise<CommentaryResult> {
  return trpcMutation(box, { procedure: "clerk.commentary", input: payload, shape: parseCommentaryResult });
}

export async function postTabArrangement(
  box: EnabledBox,
  payload: TabArrangementPayload,
): Promise<TabArrangementResult> {
  return trpcMutation(box, {
    procedure: "clerk.tabArrangement",
    input: payload,
    shape: parseTabArrangementResult,
  });
}
