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
      <Sidebar title="Commits" subtitle={`${commits.length} loaded`}>
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
