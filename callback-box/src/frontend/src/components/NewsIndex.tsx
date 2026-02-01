/**
 * NewsIndex - List of news editions with navigation.
 *
 * Shows editions in reverse chronological order with title, date, and byline.
 */

import { useState, useEffect } from "react";

/**
 * Edition metadata for the index.
 */
interface EditionSummary {
  path: string;
  relativePath: string;
  title: string;
  date: string;
  byline: string;
  status: string;
}

interface NewsIndexProps {
  /** Called when user selects an edition */
  onSelect: (edition: EditionSummary) => void;
  /** Currently selected edition path */
  selectedPath?: string;
}

/**
 * Fetch the list of news editions from the API.
 */
async function fetchEditions(): Promise<EditionSummary[]> {
  const response = await fetch("/api/editions");
  if (!response.ok) {
    throw new Error("Failed to fetch editions");
  }
  const data = await response.json();
  return data.editions;
}

/**
 * Format a date for display.
 */
function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function NewsIndex({ onSelect, selectedPath }: NewsIndexProps) {
  const [editions, setEditions] = useState<EditionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchEditions()
      .then((data) => {
        setEditions(data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <div className="p-8 text-center text-gray-500">
        Loading editions...
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8 text-center text-red-600">
        Error: {error}
      </div>
    );
  }

  if (editions.length === 0) {
    return (
      <div className="p-8 text-center text-gray-500">
        <p className="mb-2">No news editions yet.</p>
        <p className="text-sm">Run <code className="bg-gray-100 px-1 rounded">cb process-news</code> to create one.</p>
      </div>
    );
  }

  return (
    <div className="divide-y divide-gray-200">
      {editions.map((edition) => (
        <button
          key={edition.path}
          onClick={() => onSelect(edition)}
          className={`w-full text-left p-4 hover:bg-gray-50 transition-colors ${
            selectedPath === edition.path ? "bg-blue-50 border-l-4 border-blue-500" : ""
          }`}
        >
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <h3 className="font-medium text-gray-900 truncate">
                {edition.title}
              </h3>
              {edition.byline && (
                <p className="text-sm text-gray-600 mt-1 line-clamp-2">
                  {edition.byline}
                </p>
              )}
            </div>
            <div className="flex-shrink-0 text-right">
              <time className="text-sm text-gray-500">
                {formatDate(edition.date)}
              </time>
              {edition.status === "draft" && (
                <span className="block mt-1 text-xs text-yellow-600">
                  Draft
                </span>
              )}
            </div>
          </div>
        </button>
      ))}
    </div>
  );
}

export default NewsIndex;
