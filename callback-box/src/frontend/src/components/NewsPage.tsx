/**
 * NewsPage - Full news reading experience.
 *
 * Shows a sidebar with brief index and main area with the selected brief.
 * Supports comments, query responses (text and voice).
 */

import { useState, useEffect, useCallback } from "react";
import { NewsIndex, type BriefSummary } from "./NewsIndex";
import { NewsBriefView, type NewsBriefData } from "./NewsBriefView";
import { submitBriefFeedback, submitQueryResponse, markBriefRead } from "../api";

/**
 * Fetch a full brief from the API.
 */
async function fetchBrief(path: string): Promise<NewsBriefData> {
  const response = await fetch(`/api/brief/${encodeURIComponent(path)}`);
  if (!response.ok) {
    throw new Error("Failed to fetch brief");
  }
  const data = await response.json();
  return data.brief;
}

interface NewsPageProps {
  /** Optional path to load initially (from URL) */
  initialPath?: string;
  /** Called when a source is clicked */
  onSourceClick?: (sourcePath: string) => void;
  /** Called when URL should update */
  onNavigate?: (path: string | null) => void;
}

export function NewsPage({ initialPath, onSourceClick, onNavigate }: NewsPageProps) {
  const [selectedSummary, setSelectedSummary] = useState<BriefSummary | null>(null);
  const [brief, setBrief] = useState<NewsBriefData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load initial brief if path provided
  useEffect(() => {
    if (initialPath) {
      setLoading(true);
      fetchBrief(initialPath)
        .then((data) => {
          setBrief(data);
          setSelectedSummary({
            path: initialPath,
            relativePath: initialPath,
            title: data.title,
            date: data.date,
            byline: data.byline,
            read: true, // If loading by path, assume it might be read
          });
          setLoading(false);
        })
        .catch((err) => {
          setError(err.message);
          setLoading(false);
        });
    }
  }, [initialPath]);

  // Handle brief selection
  const handleSelect = useCallback(
    (summary: BriefSummary) => {
      setSelectedSummary(summary);
      setLoading(true);
      setError(null);

      // Notify parent of navigation
      onNavigate?.(summary.relativePath);

      fetchBrief(summary.relativePath)
        .then((data) => {
          setBrief(data);
          setLoading(false);

          // Mark as read if it's unread
          if (!summary.read) {
            markBriefRead(summary.relativePath).catch((err) => {
              console.error("Failed to mark brief as read:", err);
            });
          }
        })
        .catch((err) => {
          setError(err.message);
          setLoading(false);
        });
    },
    [onNavigate]
  );

  // Handle text comment submission
  const handleComment = useCallback(
    (targetId: string, comment: string) => {
      if (!selectedSummary) return;

      submitBriefFeedback(selectedSummary.relativePath, targetId, comment)
        .then(() => {
          console.log("Feedback submitted:", targetId);
        })
        .catch((err) => {
          console.error("Failed to submit feedback:", err);
        });
    },
    [selectedSummary]
  );

  // Handle voice comment submission
  const handleVoiceComment = useCallback(
    async (targetId: string, audioBlob: Blob) => {
      if (!selectedSummary) return;

      await submitBriefFeedback(
        selectedSummary.relativePath,
        targetId,
        undefined,
        audioBlob
      );
      console.log("Voice feedback submitted:", targetId);
    },
    [selectedSummary]
  );

  // Handle text query response
  const handleQueryResponse = useCallback(
    (queryId: string, response: string) => {
      if (!selectedSummary) return;

      submitQueryResponse(selectedSummary.relativePath, queryId, response)
        .then(() => {
          console.log("Query response submitted:", queryId);
        })
        .catch((err) => {
          console.error("Failed to submit query response:", err);
        });
    },
    [selectedSummary]
  );

  // Handle voice query response
  const handleVoiceQueryResponse = useCallback(
    async (queryId: string, audioBlob: Blob) => {
      if (!selectedSummary) return;

      await submitQueryResponse(
        selectedSummary.relativePath,
        queryId,
        undefined,
        audioBlob
      );
      console.log("Voice query response submitted:", queryId);
    },
    [selectedSummary]
  );

  return (
    <div className="h-screen flex">
      {/* Sidebar with index */}
      <div className="w-80 bg-white border-r flex flex-col">
        <div className="p-4 border-b">
          <h1 className="text-lg font-semibold text-gray-800">News Briefs</h1>
        </div>
        <div className="flex-1 overflow-auto">
          <NewsIndex onSelect={handleSelect} selectedPath={selectedSummary?.path} />
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 overflow-auto bg-gray-50">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-gray-500">Loading...</div>
          </div>
        ) : error ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-red-600">Error: {error}</div>
          </div>
        ) : brief ? (
          <NewsBriefView
            brief={brief}
            onComment={handleComment}
            onVoiceComment={handleVoiceComment}
            onQueryResponse={handleQueryResponse}
            onVoiceQueryResponse={handleVoiceQueryResponse}
            onSourceClick={onSourceClick}
          />
        ) : (
          <div className="flex items-center justify-center h-full text-gray-400">
            Select a brief to read
          </div>
        )}
      </div>
    </div>
  );
}

export default NewsPage;
