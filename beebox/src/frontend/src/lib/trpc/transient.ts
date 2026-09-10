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
 * `fetch`, with an unreachable box turned into a `BoxUnreachableError`. A
 * `TypeError` is how `fetch` reports a request that never got a response; an
 * abort is a `DOMException` and passes through, because a cancelled query is
 * not an outage.
 */
export async function fetchFromBox(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(input, init);
  } catch (e) {
    if (e instanceof TypeError) throw new BoxUnreachableError({ status: null, cause: e });
    throw e;
  }
  if (GATEWAY_STATUSES.has(response.status)) throw new BoxUnreachableError({ status: response.status });
  return response;
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
 * Whether the retry link tries an operation again. Queries only: a query is a
 * GET and idempotent by contract, while a mutation that hit a 502 *probably*
 * never reached the app — not a basis for replaying a send. Mutations fail
 * with the same message and leave the retry to the person.
 */
export function shouldRetryOperation({ type, attempts, error }: { type: string; attempts: number; error: unknown }): boolean {
  return type === "query" && attempts <= MAX_RETRIES && unreachableCause(error) !== null;
}
