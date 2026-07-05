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
import { href } from "../lib/routing";
import type { HistoryCommit } from "../api";
import { HistoryBrowser } from "../components/history/HistoryBrowser";
import {
  searchToFilter,
  filterToSearch,
  type HistorySearch,
} from "../components/history/history-filter";
import type { HistoryFilterState } from "../components/HistoryFilterBar";

export function HistoryPage() {
  const params = useParams({ strict: false }) as { hash?: string; boxSlug: string };
  const urlHash = params.hash;
  const boxSlug = params.boxSlug;
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as HistorySearch;

  const filter = useMemo(() => searchToFilter(search), [search]);

  const handleSelectCommit = useCallback(
    (commit: HistoryCommit) => {
      navigate({
        to: href(`/${boxSlug}/history/${commit.hash.substring(0, 8)}`),
        search: search as never,
        replace: true,
      });
    },
    [boxSlug, navigate, search]
  );

  const handleFilterChange = useCallback(
    (next: HistoryFilterState) => {
      navigate({ search: filterToSearch(next) as never, replace: false });
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
