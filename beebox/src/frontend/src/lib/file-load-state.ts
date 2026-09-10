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

import { unreachableCause } from "./trpc/transient";

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

/**
 * Turn a failure into something worth reading. An unreachable box gets our
 * sentence, with the transport fact (`HTTP 502 from the gateway`) as detail;
 * anything else keeps its own message as the headline, because it is usually
 * specific and true (`Card not found: …`). By the time this runs, the
 * unreachable case has already been retried (`lib/trpc/transient.ts`).
 */
export function describeQueryFailure(error: { message: string } | null): LoadFailure {
  if (error === null) return { headline: "The box did not answer.", detail: "" };
  const unreachable = unreachableCause(error);
  if (unreachable !== null) {
    return { headline: "The box did not answer — it may be restarting.", detail: unreachable.detail };
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
