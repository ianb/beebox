/**
 * The current URL's query, split the way a view URL is: the reserved `view`
 * key selects the renderer, everything else is a runtime override forwarded to
 * it (`?page=2`, `?molecule=H2O2`, …).
 *
 * Read from the raw search string rather than a route's typed `search`, so it
 * works on any route whether or not that route declares a search schema — the
 * params are the renderer's vocabulary, not the route's, and enumerating them
 * per route is exactly what left `/card/...?page=2` silently inert.
 *
 * Shared by browse and the full-page card route so a link behaves the same on
 * both.
 */

import { useMemo } from "react";
import { useRouterState } from "@tanstack/react-router";
import { parseViewQuery, type ViewState } from "../lib/view-url";

export interface UrlView {
  /** The `?view=` renderer name, or null. */
  viewer: string | null;
  /** Every other query param, forwarded to the active renderer. */
  params: Record<string, string>;
  viewState: ViewState | null;
}

export function useUrlView(): UrlView {
  const searchStr = useRouterState({ select: (s) => s.location.searchStr });
  return useMemo(() => parseViewQuery(searchStr), [searchStr]);
}
