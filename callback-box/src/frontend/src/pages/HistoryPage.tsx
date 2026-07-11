/**
 * HistoryPage - Main page for viewing agent run history.
 *
 * URL plumbing around HistoryBrowser (which also serves `view: history`
 * cards): filter state rides search params (connector/workflow/touchpoint/
 * feedback/session) so filtered views are shareable, and the selected
 * commit rides the /history/$hash path.
 */

import { useMemo, useCallback } from "react";
import { useParams, useNavigate, useSearch } from "@tanstack/react-router";
import { href, toSearch } from "../lib/routing";
import type { HistoryCommit } from "../api";
import { HistoryBrowser } from "../components/history/HistoryBrowser";
import {
  searchToFilter,
  filterToSearch,
  type HistorySearch,
} from "../components/history/history-filter";
import type { HistoryFilterState } from "../components/history/HistoryFilterBar";

export function HistoryPage() {
  // eslint-disable-next-line no-restricted-syntax -- router boundary: `useParams({ strict: false })` returns the union of every route's params (this page mounts under a non-strict route), so the concrete { hash?, boxSlug } shape isn't statically knowable here.
  const params = useParams({ strict: false }) as { hash?: string; boxSlug: string };
  const urlHash = params.hash;
  const boxSlug = params.boxSlug;
  const navigate = useNavigate();
  // eslint-disable-next-line no-restricted-syntax -- router boundary: `useSearch({ strict: false })` returns the union of every route's search params (this page mounts under a non-strict route), so it can't be statically typed to this page's HistorySearch shape without the cast.
  const search = useSearch({ strict: false }) as HistorySearch;

  const filter = useMemo(() => searchToFilter(search), [search]);

  const handleSelectCommit = useCallback(
    (commit: HistoryCommit) => {
      // navigate()'s promise only rejects on a superseded/redirected
      // navigation (not a user-facing failure) -- fire-and-forget.
      void navigate({
        to: href(`/${boxSlug}/history/${commit.hash.substring(0, 8)}`),
        search: toSearch(search),
        replace: true,
      });
    },
    [boxSlug, navigate, search]
  );

  const handleFilterChange = useCallback(
    (next: HistoryFilterState) => {
      void navigate({ search: toSearch(filterToSearch(next)), replace: false });
    },
    [navigate]
  );

  return (
    <HistoryBrowser
      filter={filter}
      onFilterChange={handleFilterChange}
      filterBar
      initialHash={urlHash}
      onSelectCommit={handleSelectCommit}
    />
  );
}
