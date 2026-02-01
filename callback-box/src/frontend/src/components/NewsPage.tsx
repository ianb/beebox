/**
 * NewsPage - Full news reading experience.
 *
 * Shows a sidebar with edition index and main area with the selected edition.
 * Supports comments, query responses, and voice memos.
 */

import { useState, useEffect, useCallback } from "react";
import { NewsIndex } from "./NewsIndex";
import { NewsEditionView, type NewsEditionData } from "./NewsEditionView";

/**
 * Edition metadata from the index.
 */
interface EditionSummary {
  path: string;
  relativePath: string;
  title: string;
  date: string;
  byline: string;
  status: string;
}

/**
 * Fetch a full edition from the API.
 */
async function fetchEdition(path: string): Promise<NewsEditionData> {
  const response = await fetch(`/api/edition/${encodeURIComponent(path)}`);
  if (!response.ok) {
    throw new Error("Failed to fetch edition");
  }
  const data = await response.json();
  return data.edition;
}

/**
 * Submit feedback for an edition.
 */
async function submitFeedback(editionPath: string, targetId: string, comment: string): Promise<void> {
  const response = await fetch("/api/edition/feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ editionPath, targetId, comment }),
  });
  if (!response.ok) {
    throw new Error("Failed to submit feedback");
  }
}

/**
 * Submit a query response.
 */
async function submitQueryResponse(editionPath: string, queryId: string, response: string): Promise<void> {
  const resp = await fetch("/api/edition/query-response", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ editionPath, queryId, response }),
  });
  if (!resp.ok) {
    throw new Error("Failed to submit query response");
  }
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
  const [selectedSummary, setSelectedSummary] = useState<EditionSummary | null>(null);
  const [edition, setEdition] = useState<NewsEditionData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load initial edition if path provided
  useEffect(() => {
    if (initialPath) {
      setLoading(true);
      fetchEdition(initialPath)
        .then((data) => {
          setEdition(data);
          setSelectedSummary({
            path: initialPath,
            relativePath: initialPath,
            title: data.title,
            date: data.date,
            byline: data.byline,
            status: data.status,
          });
          setLoading(false);
        })
        .catch((err) => {
          setError(err.message);
          setLoading(false);
        });
    }
  }, [initialPath]);

  // Handle edition selection
  const handleSelect = useCallback((summary: EditionSummary) => {
    setSelectedSummary(summary);
    setLoading(true);
    setError(null);

    // Notify parent of navigation
    onNavigate?.(summary.relativePath);

    fetchEdition(summary.relativePath)
      .then((data) => {
        setEdition(data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, [onNavigate]);

  // Handle comment submission
  const handleComment = useCallback((targetId: string, comment: string) => {
    if (!selectedSummary) return;

    submitFeedback(selectedSummary.relativePath, targetId, comment)
      .then(() => {
        console.log("Feedback submitted:", targetId, comment);
      })
      .catch((err) => {
        console.error("Failed to submit feedback:", err);
      });
  }, [selectedSummary]);

  // Handle query response
  const handleQueryResponse = useCallback((queryId: string, response: string) => {
    if (!selectedSummary) return;

    submitQueryResponse(selectedSummary.relativePath, queryId, response)
      .then(() => {
        console.log("Query response submitted:", queryId, response);
      })
      .catch((err) => {
        console.error("Failed to submit query response:", err);
      });
  }, [selectedSummary]);

  return (
    <div className="h-screen flex">
      {/* Sidebar with index */}
      <div className="w-80 bg-white border-r flex flex-col">
        <div className="p-4 border-b">
          <h1 className="text-lg font-semibold text-gray-800">News Editions</h1>
        </div>
        <div className="flex-1 overflow-auto">
          <NewsIndex
            onSelect={handleSelect}
            selectedPath={selectedSummary?.path}
          />
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
        ) : edition ? (
          <NewsEditionView
            edition={edition}
            onComment={handleComment}
            onQueryResponse={handleQueryResponse}
            onSourceClick={onSourceClick}
          />
        ) : (
          <div className="flex items-center justify-center h-full text-gray-400">
            Select an edition to read
          </div>
        )}
      </div>
    </div>
  );
}

export default NewsPage;
