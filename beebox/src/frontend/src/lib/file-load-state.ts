/**
 * What a file view shows: the loaded body, a loading state, a hard error, or a
 * previous body marked out of date.
 *
 * The decision lives here, apart from React, because getting it wrong is
 * invisible. It was wrong: `useFileData` returned the query's error before it
 * returned cached data, so one background refetch that failed — a 502 while the
 * box restarted — replaced a card the person was reading with an error, and
 * nothing brought it back while they kept looking at the page
 * (`issues/bugs/2026-08-31-card-sidecar-stays-failed-after-transient-502.md`).
 *
 * The rule: an error may only take content away when there is no content. A
 * failed *refresh* keeps the last good body and reports it as not up to date —
 * stale-while-revalidate, with the staleness said out loud rather than
 * swallowed (engineering principles 4 and 13).
 */

import { isRecord } from "@shared/is-record";

/** The parts of a React Query result this decision reads. */
export interface QuerySnapshot<T> {
  data: T | undefined;
  /** First load, nothing cached yet. */
  isLoading: boolean;
  /** The first load failed — there is nothing to show. */
  isLoadingError: boolean;
  /** A refresh failed — the previously loaded data still stands. */
  isRefetchError: boolean;
  error: { message: string } | null;
}

/**
 * A failure in two registers: `headline` is our sentence, shown to the person;
 * `detail` is the underlying message, shown as supporting text and used by
 * callers that match on it (the `Card not found:` case).
 */
export interface LoadFailure {
  headline: string;
  detail: string;
}

export interface LoadState<T> {
  value: T | null;
  loading: boolean;
  /** Set only when there is nothing to show. */
  error: LoadFailure | null;
  /** Set when `value` is a previous load and the newest refresh failed. */
  stale: LoadFailure | null;
}

/** HTTP statuses worth trying again: the server-side and the two "come back later" codes. */
function isTransientStatus(status: number): boolean {
  return status >= 500 || status === 408 || status === 429;
}

/**
 * tRPC error codes that describe the request rather than the moment. Retrying
 * these is pure delay: the answer will not change.
 */
const TERMINAL_TRPC_CODES = new Set([
  "NOT_FOUND",
  "BAD_REQUEST",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "CONFLICT",
  "PAYLOAD_TOO_LARGE",
  "METHOD_NOT_SUPPORTED",
  "UNPROCESSABLE_CONTENT",
]);

/**
 * Message shapes that mean "the box did not answer", in the three forms this
 * app can see them:
 *  - our own text-file loader, which throws `Failed to load: <status> <text>`;
 *  - a browser fetch that never reached a server;
 *  - a gateway that answered a non-JSON body (nginx's `Bad Gateway` page) to a
 *    request `httpBatchStreamLink` then tried to parse as JSON. That last one
 *    is why the reported bug showed the person a JSON syntax error instead of
 *    an outage: the parse failure is downstream of the 502, and is the only
 *    trace of it that reaches the client.
 */
function isTransientMessage(message: string): boolean {
  const status = /Failed to load: (\d{3})/.exec(message);
  if (status !== null) return isTransientStatus(Number(status[1]));
  if (/failed to fetch|networkerror|load failed|network error|err_connection/.test(message.toLowerCase())) return true;
  return /is not valid JSON|Failed to execute 'json'|Unexpected token/.test(message);
}

/**
 * Whether an error is worth retrying. Takes `unknown` because React Query's
 * `retry` callback hands the error through untyped.
 */
export function isTransientQueryError(error: unknown): boolean {
  if (!isRecord(error)) return false;
  const data = error["data"];
  if (isRecord(data)) {
    const code = data["code"];
    if (typeof code === "string" && TERMINAL_TRPC_CODES.has(code)) return false;
    const httpStatus = data["httpStatus"];
    if (typeof httpStatus === "number") return isTransientStatus(httpStatus);
  }
  const message = error["message"];
  return typeof message === "string" && isTransientMessage(message);
}

/**
 * Turn a failure into something worth reading. A transient failure gets our
 * sentence, because the underlying message names the wrong problem; anything
 * else keeps its own message as the headline, because it is usually specific
 * and true (`Card not found: …`).
 */
export function describeQueryFailure(error: { message: string } | null): LoadFailure {
  if (error === null) return { headline: "The box did not answer.", detail: "" };
  if (isTransientQueryError(error)) {
    return { headline: "The box did not answer — it may be restarting.", detail: error.message };
  }
  return { headline: error.message, detail: error.message };
}

/**
 * Fold a query result into what the view should render. Cached data always
 * wins over a refresh that failed; a first load that failed is still an error.
 */
export function resolveLoadState<T>(query: QuerySnapshot<T>): LoadState<T> {
  if (query.data !== undefined) {
    const stale = query.isRefetchError ? describeQueryFailure(query.error) : null;
    return { value: query.data, loading: false, error: null, stale };
  }
  if (query.isLoadingError && query.error !== null) {
    return { value: null, loading: false, error: describeQueryFailure(query.error), stale: null };
  }
  if (query.isLoading) return { value: null, loading: true, error: null, stale: null };
  // No data, no failure, not loading: a disabled query, or one whose result is
  // genuinely absent. The caller decides what that means for its file type.
  return { value: null, loading: false, error: null, stale: null };
}
