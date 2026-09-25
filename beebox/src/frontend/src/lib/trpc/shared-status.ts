/**
 * One fetch per status probe, shared between a section's own imperative read
 * (an XState actor, a `useEffect`) and the admin overview's `useQuery` of the
 * same procedure. Some probes spawn a CLI on the host and can take seconds;
 * running them twice per page load doubled that cost.
 *
 * `staleTime: 0` keeps the imperative caller's contract (always ask the
 * server) while an in-flight request for the same key is joined rather than
 * repeated, and the answer lands in the query cache for the overview.
 */

import type { QueryKey } from "@tanstack/react-query";
import { queryClient } from "./query-client";

export function fetchSharedStatus<T>({ queryKey, queryFn }: { queryKey: QueryKey; queryFn: () => Promise<T> }): Promise<T> {
  return queryClient.fetchQuery({ queryKey, queryFn, staleTime: 0 });
}
