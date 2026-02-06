/**
 * HistoryPage - Main page for viewing agent run history.
 *
 * Two-panel layout: CommitTimeline (left, collapsible) + CommitDetail (right).
 * URL reflects selected commit: /history/:hash
 */

import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { getHistory, type HistoryCommit } from "../api";
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
  const [sidebarOpen, setSidebarOpen] = useState(true);

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
            navigate(`/history/${result.commits[0].hash.substring(0, 8)}`, { replace: true });
          }
        } else if (result.commits.length > 0) {
          setSelectedCommit(result.commits[0]);
          navigate(`/history/${result.commits[0].hash.substring(0, 8)}`, { replace: true });
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
  }, [urlHash, navigate]);

  useEffect(() => {
    loadCommits(0);
  }, [loadCommits]);

  const handleSelect = (commit: HistoryCommit) => {
    setSelectedCommit(commit);
    navigate(`/history/${commit.hash.substring(0, 8)}`);
  };

  const handleLoadMore = () => {
    loadCommits(commits.length);
  };

  return (
    <div className="h-full flex">
      {/* Sidebar toggle button (shown when sidebar is collapsed) */}
      {!sidebarOpen && (
        <div className="flex-shrink-0 border-r bg-white">
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-2 hover:bg-gray-100 text-gray-500 hover:text-gray-700"
            title="Show commit list"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
        </div>
      )}

      {/* Left panel: commit timeline */}
      {sidebarOpen && (
        <div className="w-80 border-r bg-white flex-shrink-0 overflow-hidden flex flex-col">
          <CommitTimeline
            commits={commits}
            selectedHash={selectedCommit?.hash || null}
            onSelect={handleSelect}
            onLoadMore={handleLoadMore}
            hasMore={hasMore}
            loading={loading}
            onCollapse={() => setSidebarOpen(false)}
          />
        </div>
      )}

      {/* Right panel: commit detail */}
      <div className="flex-1 bg-white overflow-hidden">
        {selectedCommit ? (
          <CommitDetail commit={selectedCommit} />
        ) : (
          <div className="flex items-center justify-center h-full text-gray-400">
            {loading ? "Loading..." : "Select a commit to view details"}
          </div>
        )}
      </div>
    </div>
  );
}
