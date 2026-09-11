/**
 * "The box did not answer" as a typed failure, and how long to keep asking.
 *
 * A deploy restarts the hub, and for about a minute nginx answers every request
 * with its own HTML 502 page. A box child that is down or restarting gets the
 * hub's JSON 502 instead. Neither body is a tRPC response, and before this the
 * batch link parsed nginx's page as JSON and showed the person
 * `Unexpected token '<', "<!DOCTYPE "... is not valid JSON` — an outage
 * disguised as a client bug, and with query retries off, a permanent one.
 *
 * So the transport decides, once, from the one thing only it can see: the HTTP
 * status. A 502/503/504 or a request that never reached a server becomes a
 * `BoxUnreachableError`, whose message is the sentence to show. The retry link
 * reads the class, never a message; the UI shows the message as-is.
 *
 * Status, not content-type: the hub's own 502 is JSON. And only these three —
 * a procedure's own failure never reaches here as a status (the stream link's
 * HTTP status is 200 once the server starts writing), and a 401 is handled in
 * `trpcFetch` before this runs.
 *
 * See `issues/bugs/2026-09-09-deploy-restart-502-surfaces-as-json-parse-error.md`.
 */

import { isRecord } from "@shared/is-record";

const BOX_UNREACHABLE_MESSAGE = "The box did not answer — it may be restarting. Try again in a moment.";

/** What a proxy answers when nothing behind it is serving. */
const GATEWAY_STATUSES = new Set([502, 503, 504]);

export class BoxUnreachableError extends Error {
  /** The gateway's status, or null when no response arrived at all. */
  readonly status: number | null;

  constructor({ status, cause }: { status: number | null; cause?: unknown }) {
    super(BOX_UNREACHABLE_MESSAGE, { cause });
    this.name = "BoxUnreachableError";
    this.status = status;
  }

  /** The transport fact behind the sentence, for supporting text. */
  get detail(): string {
    if (this.status !== null) return `HTTP ${this.status} from the gateway`;
    return this.cause instanceof Error ? this.cause.message : "no response";
  }
}

/**
 * A `TypeError` is how `fetch` reports a connection that failed — before the
 * response, or partway through its body. An abort is a `DOMException` and
 * passes through, because a cancelled query is not an outage.
 */
function asUnreachable(error: unknown): BoxUnreachableError | null {
  return error instanceof TypeError ? new BoxUnreachableError({ status: null, cause: error }) : null;
}

/**
 * The body, with a connection that breaks off partway turned into a
 * `BoxUnreachableError`. A batch streams each result as it resolves, so the
 * status can be a healthy 200 and the connection can still die before a slow
 * member's line arrives — a deploy kills the hub mid-flight. The batch link
 * rejects that member with the read error itself, so classifying it here is
 * enough for the retry link to see it. Members already delivered keep their
 * result; only the unfinished ones fail.
 */
function classifyBodyFailures(body: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch (e) {
        controller.error(asUnreachable(e) ?? e);
        return;
      }
      if (chunk.done) controller.close();
      else controller.enqueue(chunk.value);
    },
    cancel: (reason) => reader.cancel(reason),
  });
}

/** `fetch`, with an unreachable box turned into a `BoxUnreachableError`. */
export async function fetchFromBox(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(input, init);
  } catch (e) {
    const unreachable = asUnreachable(e);
    if (unreachable !== null) throw unreachable;
    throw e;
  }
  if (GATEWAY_STATUSES.has(response.status)) throw new BoxUnreachableError({ status: response.status });
  if (response.body === null) return response;
  const { status, statusText, headers } = response;
  return new Response(classifyBodyFailures(response.body), { status, statusText, headers });
}

/**
 * The `BoxUnreachableError` behind an error, if any: the error itself, or the
 * `cause` of the `TRPCClientError` the batch link wraps it in.
 */
export function unreachableCause(error: unknown): BoxUnreachableError | null {
  if (error instanceof BoxUnreachableError) return error;
  if (isRecord(error) && error["cause"] instanceof BoxUnreachableError) return error["cause"];
  return null;
}

/**
 * Whether an error is this transport's "the box did not answer" classification
 * — reused by the voice-staging queue (`lib/audio/voice-staging-queue.ts`) to
 * decide whether an upload op is worth retrying, the same test the retry link
 * applies to a query.
 */
export function isBoxUnreachable(error: unknown): boolean {
  return unreachableCause(error) !== null;
}

/**
 * The wait before each retry, in order. A deploy restart has measured ~60 s
 * from SIGTERM to serving, and a request can land at its very start, so the
 * schedule spans ~91 s before giving up. Past that the person sees the message
 * and nothing retries on a timer — nothing retries forever.
 */
const RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000];

/** How many retries follow the first attempt. */
export const MAX_RETRIES = RETRY_DELAYS_MS.length;

/** The wait before retry number `retry` (1-based). */
export function retryDelayMs(retry: number): number {
  return RETRY_DELAYS_MS[Math.min(retry, MAX_RETRIES) - 1] ?? 0;
}

/**
 * Whether the retry link tries an operation again.
 *
 * A query is a GET and idempotent by contract, so it always qualifies. A
 * mutation that hit a 502 *probably* never reached the app, but "probably" is
 * not a basis for replaying a send that mutates state — unless the caller has
 * said, per call, that THIS mutation is safe to replay: `voiceRecording.claim`
 * and `.fallBack` (`lib/trpc/index.ts`'s `idempotent: op.context["idempotent"]
 * === true`) apply one idempotent transition keyed by `(recordingId,
 * emissionId)`, so a retried call after an unanswered first attempt repeats
 * nothing — it either lands once or confirms the first attempt already did.
 * Every other mutation still fails with the same message and leaves the retry
 * to the person.
 */
export function shouldRetryOperation(
  { type, attempts, error, idempotent }: { type: string; attempts: number; error: unknown; idempotent: boolean },
): boolean {
  const retryable = type === "query" || (type === "mutation" && idempotent);
  return retryable && attempts <= MAX_RETRIES && unreachableCause(error) !== null;
}
