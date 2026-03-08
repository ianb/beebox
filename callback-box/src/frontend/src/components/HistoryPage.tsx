/**
 * HistoryPage - Main page for viewing agent run history.
 *
 * Two-panel layout: Sidebar with CommitTimeline (left, collapsible) + CommitDetail (right).
 * URL reflects selected commit: /history/:hash
 */

import { useState, useMemo } from "react";
import { useParams, useNavigate } from "@tanstack/react-router";
import { href } from "../lib/routing";
import type { HistoryCommit } from "../api";
import { trpc } from "../lib/trpc";
import { Sidebar } from "./Sidebar";
import { CommitTimeline } from "./CommitTimeline";
import { CommitDetail } from "./CommitDetail";

const PAGE_SIZE = 50;

export function HistoryPage() {
  const params = useParams({ strict: false }) as { hash?: string; boxSlug: string };
  const urlHash = params.hash;
  const boxSlug = params.boxSlug;
  const navigate = useNavigate();
  const [selectedCommit, setSelectedCommit] = useState<HistoryCommit | null>(null);

  const { data, isLoading, hasNextPage, fetchNextPage, isFetchingNextPage } =
    trpc.history.list.useInfiniteQuery(
      { count: PAGE_SIZE },
      {
        getNextPageParam: (lastPage) => lastPage.nextCursor,
      }
    );

  const commits = useMemo(
    () => data?.pages.flatMap((p) => p.commits) ?? [],
    [data]
  );

  // Auto-select when initial data arrives (setState during render — React-approved pattern)
  const [prevFirstPage, setPrevFirstPage] = useState(data?.pages[0]);
  const firstPage = data?.pages[0];
  if (firstPage !== prevFirstPage) {
    setPrevFirstPage(firstPage);
    if (firstPage && firstPage.commits.length > 0) {
      if (urlHash) {
        const match = firstPage.commits.find((c) => c.hash.startsWith(urlHash));
        setSelectedCommit(match ?? firstPage.commits[0]);
      } else {
        setSelectedCommit(firstPage.commits[0]);
      }
    }
  }

  const loading = isLoading || isFetchingNextPage;

  const handleSelect = (commit: HistoryCommit) => {
    setSelectedCommit(commit);
    navigate({ to: href(`/${boxSlug}/history/${commit.hash.substring(0, 8)}`), replace: true });
  };

  const handleLoadMore = () => {
    fetchNextPage();
  };

  const hasDetail = Boolean(selectedCommit);

  return (
    <div className="h-full flex">
      <Sidebar title="Commits" subtitle={`${commits.length} loaded`} detailSelected={hasDetail}>
        <CommitTimeline
          commits={commits}
          selectedHash={selectedCommit?.hash || null}
          onSelect={handleSelect}
          onLoadMore={handleLoadMore}
          hasMore={hasNextPage ?? false}
          loading={loading}
        />
      </Sidebar>

      {/* Right panel: commit detail */}
      <div className={`flex-1 bg-white overflow-hidden ${hasDetail ? "" : "hidden sm:block"}`}>
        {selectedCommit ? (
          <div className="h-full flex flex-col">
            <button
              onClick={() => setSelectedCommit(null)}
              className="sm:hidden flex items-center gap-1 px-3 py-2 text-sm text-plum hover:text-plum-dark border-b"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Back to commits
            </button>
            <div className="flex-1 overflow-hidden">
              <CommitDetail commit={selectedCommit} />
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-warm-500">
            {loading ? "Loading..." : "Select a commit to view details"}
          </div>
        )}
      </div>
    </div>
  );
}
