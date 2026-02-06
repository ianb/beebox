/**
 * NewsPage - Full news reading experience.
 *
 * Shows a sidebar with brief index and main area with the selected brief.
 * Supports comments, query responses (text and voice).
 */

import { useState, useEffect, useCallback } from "react";
import { NewsIndex, type BriefSummary } from "./NewsIndex";
import {
  NewsBriefView,
  type NewsBriefData,
  type GuideReaction,
  type BriefReaction,
} from "./NewsBriefView";
import {
  submitBriefFeedback,
  submitQueryResponse,
  getGuideReactions,
  completeReading,
} from "../api";

/**
 * Extended brief data including curation reactions.
 */
interface BriefWithReactions extends NewsBriefData {
  briefReactions: BriefReaction[];
}

/**
 * Fetch a full brief from the API.
 */
async function fetchBrief(path: string): Promise<BriefWithReactions> {
  const response = await fetch(`/api/brief/${encodeURIComponent(path)}`);
  if (!response.ok) {
    throw new Error("Failed to fetch brief");
  }
  const data = await response.json();
  // Extract brief reactions from curation
  const briefReactions: BriefReaction[] = data.brief.curation?.briefReactions ?? [];
  return {
    ...data.brief,
    briefReactions,
  };
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
  const [brief, setBrief] = useState<BriefWithReactions | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [guideReactions, setGuideReactions] = useState<GuideReaction[]>([]);

  // Fetch guide reactions on mount
  useEffect(() => {
    getGuideReactions()
      .then((data) => {
        setGuideReactions(data.reactions);
      })
      .catch((err) => {
        console.error("Failed to fetch guide reactions:", err);
      });
  }, []);

  // Load initial brief if path provided
  useEffect(() => {
    if (initialPath) {
      setLoading(true);
      fetchBrief(initialPath)
        .then((data) => {
          setBrief(data);
          // Briefs in box/output/briefs/ are unread; those in store/archive/briefs/ are read
          const isUnread = initialPath.includes("box/output/briefs/");
          setSelectedSummary({
            path: initialPath,
            relativePath: initialPath,
            title: data.title,
            date: data.date,
            byline: data.byline,
            read: !isUnread,
          });
          setLoading(false);
        })
        .catch((err) => {
          setError(err.message);
          setLoading(false);
        });
    }
  }, [initialPath]);

  // Handle brief selection - no longer auto-marks as read
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
        })
        .catch((err) => {
          setError(err.message);
          setLoading(false);
        });
    },
    [onNavigate]
  );

  // Handle completion of reading with feedback
  const handleCompleteReading = useCallback(
    async (data: {
      overallRating: "great" | "ok" | "meh";
      selectedReactions: Array<{ id: string; source: "guide" | "brief" }>;
      itemFeedback: Array<{ id: string; feedback: "thumbs-up" | "thumbs-down" }>;
    }) => {
      if (!selectedSummary) return;

      await completeReading(
        selectedSummary.relativePath,
        data.overallRating,
        data.selectedReactions,
        data.itemFeedback
      );
      console.log("Reading completed with feedback");

      // Update the summary to show as read
      setSelectedSummary((prev) => prev ? { ...prev, read: true } : null);
    },
    [selectedSummary]
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
    <div className="h-full flex">
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
            guideReactions={guideReactions}
            briefReactions={brief.briefReactions}
            onCompleteReading={selectedSummary && !selectedSummary.read ? handleCompleteReading : undefined}
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
