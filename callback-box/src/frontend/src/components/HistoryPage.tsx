/**
 * HistoryPage - Main page for viewing agent run history.
 *
 * Two-panel layout: Sidebar with CommitTimeline (left, collapsible) + CommitDetail (right).
 * URL reflects selected commit: /history/:hash
 */

import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { getHistory, type HistoryCommit } from "../api";
import { Sidebar } from "./Sidebar";
import { CommitTimeline } from "./CommitTimeline";
import { CommitDetail } from "./CommitDetail";

const PAGE_SIZE = 50;

export function HistoryPage() {
  const { hash: urlHash } = useParams<{ hash?: string }>();
  const navigate = useNavigate();
  const [commits, setCommits] = useState<HistoryCommit[]>([]);
  const [selectedCommit, setSelectedCommit] = useState<HistoryCommit | null>(null);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(true);

  const loadCommits = useCallback(async (offset: number) => {
    try {
      setLoading(true);
      const result = await getHistory(PAGE_SIZE, offset);
      if (offset === 0) {
        setCommits(result.commits);
        // Auto-select from URL hash, or first commit
        if (urlHash) {
          const match = result.commits.find((c) => c.hash.startsWith(urlHash));
          if (match) {
            setSelectedCommit(match);
          } else if (result.commits.length > 0) {
            setSelectedCommit(result.commits[0]);
          }
        } else if (result.commits.length > 0) {
          setSelectedCommit(result.commits[0]);
        }
      } else {
        setCommits((prev) => [...prev, ...result.commits]);
      }
      setHasMore(result.commits.length === PAGE_SIZE);
    } catch (err) {
      console.error("Failed to load history:", err);
    } finally {
      setLoading(false);
    }
  }, [urlHash]);

  useEffect(() => {
    loadCommits(0);
  }, [loadCommits]);

  const handleSelect = (commit: HistoryCommit) => {
    setSelectedCommit(commit);
    navigate(commit.hash.substring(0, 8), { replace: true });
  };

  const handleLoadMore = () => {
    loadCommits(commits.length);
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
          hasMore={hasMore}
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
