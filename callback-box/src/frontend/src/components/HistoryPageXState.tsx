/**
 * HistoryPage — XState version.
 *
 * State is a machine with explicit loading/idle/error states.
 * Context holds the data. `state.matches("loading")` replaces boolean flags.
 * Error recovery is a first-class state transition.
 */

import { useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useMachine } from "@xstate/react";
import { type HistoryCommit } from "../api";
import { historyMachine } from "../stores/history-xstate";
import { Sidebar } from "./Sidebar";
import { CommitTimeline } from "./CommitTimeline";
import { CommitDetail } from "./CommitDetail";

export function HistoryPageXState() {
  const { hash: urlHash } = useParams<{ hash?: string }>();
  const navigate = useNavigate();
  const [state, send] = useMachine(historyMachine);
  const { commits, selectedHash, hasMore } = state.context;
  const selectedCommit = commits.find((c) => c.hash === selectedHash) || null;
  const loading = state.matches("loading");

  // URL → selection sync
  useEffect(() => {
    if (commits.length > 0 && !selectedHash) {
      const match = urlHash
        ? commits.find((c) => c.hash.startsWith(urlHash))
        : commits[0];
      if (match) send({ type: "SELECT", hash: match.hash });
    }
  }, [commits, urlHash, selectedHash, send]);

  const handleSelect = (commit: HistoryCommit) => {
    send({ type: "SELECT", hash: commit.hash });
    navigate(commit.hash.substring(0, 8), { replace: true });
  };

  const hasDetail = Boolean(selectedCommit);

  return (
    <div className="h-full flex">
      <Sidebar title="Commits (XState)" subtitle={`${commits.length} loaded`} detailSelected={hasDetail}>
        <CommitTimeline
          commits={commits}
          selectedHash={selectedHash}
          onSelect={handleSelect}
          onLoadMore={() => send({ type: "LOAD_MORE" })}
          hasMore={hasMore}
          loading={loading}
        />
      </Sidebar>

      <div className={`flex-1 bg-white overflow-hidden ${hasDetail ? "" : "hidden sm:block"}`}>
        {state.matches("error") ? (
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <p className="text-red-600">Failed to load history: {state.context.error}</p>
            <button
              onClick={() => send({ type: "RETRY" })}
              className="px-4 py-2 bg-plum text-white rounded hover:bg-plum-dark"
            >
              Retry
            </button>
          </div>
        ) : selectedCommit ? (
          <div className="h-full flex flex-col">
            <button
              onClick={() => send({ type: "SELECT", hash: null })}
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
