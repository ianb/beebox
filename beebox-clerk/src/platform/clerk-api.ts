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
  SendPayload,
  SendResult,
  TabArrangementPayload,
  TabArrangementResult,
} from "../contract/clerk-contract.generated.js";
import { isRecord } from "../domain/is-record.js";
import type { SendView } from "../domain/send.js";

export class ClerkApiError extends Error {
  constructor(
    readonly status: number,
    options: { endpoint: string; detail: string },
  ) {
    super(`Clerk API ${options.endpoint} failed (${status === 0 ? "network" : status}): ${options.detail}`);
    this.name = "ClerkApiError";
  }
}

/** The box has no `clerk.send` (tRPC answers 404): it predates Send and needs an update. */
export class SendUnsupportedError extends ClerkApiError {
  constructor(detail: string) {
    super(404, { endpoint: "clerk.send", detail });
    this.name = "SendUnsupportedError";
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

/**
 * Waits before each retry of a POST. Two retries cover a dropped connection or
 * a restarting box without holding the capture for long.
 */
const RETRY_DELAYS_MS = [1000, 3000];

/**
 * Commentary retries failures after which the box may or may not have written
 * the capture: no response at all, or a proxy/gateway error in front of the
 * box. A 500 is the box's own answer and is not retried.
 */
const COMMENTARY_RETRY_STATUSES: readonly number[] = [0, 502, 503, 504];

/** Send also retries a 500: the box answers a repeat of the same id with the stored result. */
const SEND_RETRY_STATUSES: readonly number[] = [0, 500, 502, 503, 504];

/**
 * Run `attempt` until it succeeds, retrying a `ClerkApiError` whose status is
 * in `statuses` after each delay in turn. The caller's attempt must resend the
 * SAME payload: only an id the box dedupes on makes a replay safe.
 */
async function withRetries<T>(
  attempt: () => Promise<T>,
  policy: { delaysMs: readonly number[]; statuses: readonly number[]; label: string },
): Promise<T> {
  for (let n = 0; ; n++) {
    try {
      return await attempt();
    } catch (error) {
      const delay = policy.delaysMs[n];
      const retryable = error instanceof ClerkApiError && policy.statuses.includes(error.status);
      if (delay === undefined || !retryable) throw error;
      console.info(`[clerk] ${policy.label} failed (attempt ${n + 1}); retrying`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

/**
 * Post one capture, retrying an ambiguous failure with the SAME payload. The
 * payload's `captureId` makes a replay safe: the box returns the first
 * attempt's result instead of writing a second card. A new user action must
 * build a new payload (new `captureId`); only this retry loop reuses one.
 */
export async function postCommentary(
  box: EnabledBox,
  request: { payload: CommentaryPayload & { captureId: string }; retryDelaysMs?: readonly number[] },
): Promise<CommentaryResult> {
  const { payload } = request;
  return withRetries(
    () => trpcMutation(box, { procedure: "clerk.commentary", input: payload, shape: parseCommentaryResult }),
    {
      delaysMs: request.retryDelaysMs ?? RETRY_DELAYS_MS,
      statuses: COMMENTARY_RETRY_STATUSES,
      label: `commentary post for capture ${payload.captureId}`,
    },
  );
}

const SEND_STATES: ReadonlySet<unknown> = new Set(["needs-choice", "sending", "sent", "discarded"]);
const SEND_REASONS: ReadonlySet<unknown> = new Set(["uncertain", "routing-unavailable", "destination-gone"]);

function parseSendDestination(value: unknown): NonNullable<SendView["destination"]> | null {
  if (!isRecord(value) || typeof value["label"] !== "string") return null;
  const sessionId = value["sessionId"];
  if (sessionId === undefined) return { label: value["label"] };
  return typeof sessionId === "string" ? { label: value["label"], sessionId } : null;
}

function parseSendChoices(value: unknown): NonNullable<SendView["choices"]> | null {
  if (!Array.isArray(value)) return null;
  const choices: NonNullable<SendView["choices"]> = [];
  for (const raw of value) {
    if (!isRecord(raw)) return null;
    const { candidateId, label, detail } = raw;
    if (typeof candidateId !== "string" || typeof label !== "string") return null;
    if (detail !== undefined && typeof detail !== "string") return null;
    choices.push(detail === undefined ? { candidateId, label } : { candidateId, label, detail });
  }
  return choices;
}

/** Copies the optional view fields that are present and well-typed; false on a wrong type. */
function readOptionalViewFields(data: Record<string, unknown>, view: SendView): boolean {
  const { destination, queued, reason, lastError, expired, choices } = data;
  if (destination !== undefined) {
    const parsed = parseSendDestination(destination);
    if (parsed === null) return false;
    view.destination = parsed;
  }
  if (queued !== undefined) {
    if (typeof queued !== "boolean") return false;
    view.queued = queued;
  }
  if (reason !== undefined) {
    if (!SEND_REASONS.has(reason)) return false;
    view.reason = reason === "uncertain" || reason === "routing-unavailable" ? reason : "destination-gone";
  }
  if (lastError !== undefined) {
    if (typeof lastError !== "string") return false;
    view.lastError = lastError;
  }
  if (expired !== undefined) {
    if (typeof expired !== "boolean") return false;
    view.expired = expired;
  }
  if (choices !== undefined) {
    const parsed = parseSendChoices(choices);
    if (parsed === null) return false;
    view.choices = parsed;
  }
  return true;
}

/**
 * Runtime twin of the generated `SendResult` without `card`: also reads the
 * quick chat view `quickChat.choose` answers (its extra fields are ignored).
 */
export function parseSendView(data: unknown): SendView | null {
  if (!isRecord(data)) return null;
  const state = data["state"];
  if (!SEND_STATES.has(state)) return null;
  const view: SendView = {
    state: state === "needs-choice" || state === "sending" || state === "sent" ? state : "discarded",
  };
  return readOptionalViewFields(data, view) ? view : null;
}

/** Runtime twin of the generated `SendResult`. */
export function parseSendResult(data: unknown): SendResult | null {
  if (!isRecord(data) || typeof data["card"] !== "string") return null;
  const view = parseSendView(data);
  return view === null ? null : { card: data["card"], ...view };
}

/**
 * Post one send, retrying a lost answer (network, 500, 502-504) with the SAME
 * payload: the box answers a repeat of the id with the stored result. A 404
 * means the box predates `clerk.send` and becomes `SendUnsupportedError`.
 */
export async function postSend(
  box: EnabledBox,
  request: { payload: SendPayload; retryDelaysMs?: readonly number[] },
): Promise<SendResult> {
  const { payload } = request;
  try {
    return await withRetries(
      () => trpcMutation(box, { procedure: "clerk.send", input: payload, shape: parseSendResult }),
      {
        delaysMs: request.retryDelaysMs ?? RETRY_DELAYS_MS,
        statuses: SEND_RETRY_STATUSES,
        label: `send ${payload.id}`,
      },
    );
  } catch (error) {
    if (error instanceof ClerkApiError && error.status === 404) throw new SendUnsupportedError(error.message);
    throw error;
  }
}

/** Fix the destination of a send that needs a choice, and deliver it (`quickChat.choose`). */
export async function chooseSendDestination(
  box: EnabledBox,
  choice: { id: string; candidateId: string },
): Promise<SendView> {
  return trpcMutation(box, {
    procedure: "quickChat.choose",
    input: { id: choice.id, candidateId: choice.candidateId },
    shape: parseSendView,
  });
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
