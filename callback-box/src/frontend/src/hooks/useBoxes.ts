/**
 * The box list, as one shared react-query query.
 *
 * `AppLayout` (box-exists check), `AppNav` (box switcher), and `BoxRedirect`
 * all need it; each used to run its own `fetch`, so a page load asked the
 * server for the same list two or three times. One query key means one
 * request, with the shared client's staleTime applying to it like any other.
 */

import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchBoxes, type KnownBox } from "../lib/boxes";

export interface BoxesState {
  boxes: KnownBox[];
  /** The server said auth is required and returned no boxes for this caller. */
  authRequired: boolean;
  /** The request has settled — successfully or not. */
  loaded: boolean;
  /** The request failed; `boxes` is empty because we couldn't ask, not because there are none. */
  error: boolean;
}

export function useBoxes(): BoxesState {
  const query = useQuery({ queryKey: ["boxes"], queryFn: fetchBoxes });
  // The three former call sites each logged their own failure; keep that
  // observability now that the fetch is shared (a box server we can't reach
  // is worth a console error, not a silent empty list).
  const { error } = query;
  useEffect(() => {
    if (error) console.error("Failed to load the box list:", error);
  }, [error]);
  if (query.data) {
    // `error` reports the LAST attempt, even alongside data: react-query keeps
    // showing the previous list when a refetch fails, and a caller that treats
    // that as a validated list would rule a box "not found" off stale data.
    return { boxes: query.data.boxes, authRequired: query.data.authRequired ?? false, loaded: true, error: query.isError };
  }
  return { boxes: [], authRequired: false, loaded: query.isError, error: query.isError };
}
