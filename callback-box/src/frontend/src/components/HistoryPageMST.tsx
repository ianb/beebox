/**
 * HistoryPage — MobX-State-Tree version.
 *
 * State lives in a typed MST model. Components wrapped in observer() for reactivity.
 * `getSnapshot(store)` returns plain JSON at any time.
 */

import { useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { observer } from "mobx-react-lite";
import { type HistoryCommit } from "../api";
import { historyStore } from "../stores/history-mst";
import { Sidebar } from "./Sidebar";
import { CommitTimeline } from "./CommitTimeline";
import { CommitDetail } from "./CommitDetail";

export const HistoryPageMST = observer(function HistoryPageMST() {
  const { hash: urlHash } = useParams<{ hash?: string }>();
  const navigate = useNavigate();
  const store = historyStore;
  const { selectedCommit } = store;

  // Initial load
  useEffect(() => {
    store.loadPage(0);
  }, [store]);

  // URL → selection sync
  useEffect(() => {
    if (store.commits.length > 0 && !store.selectedHash) {
      const match = urlHash
        ? store.commits.find((c) => c.hash.startsWith(urlHash))
        : store.commits[0];
      if (match) store.select(match.hash);
    }
  }, [store, store.commits.length, urlHash, store.selectedHash]);

  const handleSelect = (commit: HistoryCommit) => {
    store.select(commit.hash);
    navigate(commit.hash.substring(0, 8), { replace: true });
  };

  const hasDetail = Boolean(selectedCommit);

  return (
    <div className="h-full flex">
      <Sidebar title="Commits (MST)" subtitle={`${store.commits.length} loaded`} detailSelected={hasDetail}>
        <CommitTimeline
          commits={store.commits.slice()}
          selectedHash={store.selectedHash}
          onSelect={handleSelect}
          onLoadMore={() => store.loadMore()}
          hasMore={store.hasMore}
          loading={store.loading}
        />
      </Sidebar>

      <div className={`flex-1 bg-white overflow-hidden ${hasDetail ? "" : "hidden sm:block"}`}>
        {selectedCommit ? (
          <div className="h-full flex flex-col">
            <button
              onClick={() => store.select(null)}
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
            {store.loading ? "Loading..." : "Select a commit to view details"}
          </div>
        )}
      </div>
    </div>
  );
});
