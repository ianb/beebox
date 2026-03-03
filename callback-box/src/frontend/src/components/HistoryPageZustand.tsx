/**
 * HistoryPage — Zustand version.
 *
 * State lives in a Zustand store. The component reads via hook and dispatches actions.
 * URL sync remains in the component (Zustand has no opinion about routing).
 */

import { useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { type HistoryCommit } from "../api";
import { useHistoryStore } from "../stores/history-zustand";
import { Sidebar } from "./Sidebar";
import { CommitTimeline } from "./CommitTimeline";
import { CommitDetail } from "./CommitDetail";

export function HistoryPageZustand() {
  const { hash: urlHash } = useParams<{ hash?: string }>();
  const navigate = useNavigate();
  const { commits, selectedHash, loading, hasMore, select, loadPage, loadMore } =
    useHistoryStore();
  const selectedCommit = commits.find((c) => c.hash === selectedHash) || null;

  // Initial load
  useEffect(() => {
    loadPage(0);
  }, [loadPage]);

  // URL → selection sync
  useEffect(() => {
    if (commits.length > 0 && !selectedHash) {
      const match = urlHash
        ? commits.find((c) => c.hash.startsWith(urlHash))
        : commits[0];
      if (match) select(match.hash);
    }
  }, [commits, urlHash, selectedHash, select]);

  const handleSelect = (commit: HistoryCommit) => {
    select(commit.hash);
    navigate(commit.hash.substring(0, 8), { replace: true });
  };

  const hasDetail = Boolean(selectedCommit);

  return (
    <div className="h-full flex">
      <Sidebar title="Commits (Zustand)" subtitle={`${commits.length} loaded`} detailSelected={hasDetail}>
        <CommitTimeline
          commits={commits}
          selectedHash={selectedHash}
          onSelect={handleSelect}
          onLoadMore={loadMore}
          hasMore={hasMore}
          loading={loading}
        />
      </Sidebar>

      <div className={`flex-1 bg-white overflow-hidden ${hasDetail ? "" : "hidden sm:block"}`}>
        {selectedCommit ? (
          <div className="h-full flex flex-col">
            <button
              onClick={() => select(null)}
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
