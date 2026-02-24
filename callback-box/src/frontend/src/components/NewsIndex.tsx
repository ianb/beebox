/**
 * NewsIndex - List of news briefs with navigation.
 *
 * Shows briefs in reverse chronological order with title, date, and byline.
 * Unread briefs are shown with bold titles, read briefs are dimmer.
 */

import { useState, useEffect } from "react";
import { getApiBase } from "../api";

/**
 * Brief metadata for the index.
 */
export interface BriefSummary {
  path: string;
  relativePath: string;
  title: string;
  date: string;
  byline: string;
  read: boolean;
  readReason?: "user" | "expired";
}

interface NewsIndexProps {
  /** Called when user selects a brief */
  onSelect: (brief: BriefSummary) => void;
  /** Currently selected brief path */
  selectedPath?: string;
  /** Increment to trigger a refresh of the brief list */
  refreshKey?: number;
}

/**
 * Fetch the list of news briefs from the API.
 */
async function fetchBriefs(): Promise<BriefSummary[]> {
  const response = await fetch(`${getApiBase()}/briefs`);
  if (!response.ok) {
    throw new Error("Failed to fetch briefs");
  }
  const data = await response.json();
  return data.briefs;
}

/**
 * Format a date for display using relative dates for recent items.
 */
function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;

  const sameYear = date.getFullYear() === now.getFullYear();
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

export function NewsIndex({ onSelect, selectedPath, refreshKey }: NewsIndexProps) {
  const [briefs, setBriefs] = useState<BriefSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchBriefs()
      .then((data) => {
        setBriefs(data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, [refreshKey]);

  if (loading) {
    return (
      <div className="p-8 text-center text-gray-500">
        Loading briefs...
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

  if (briefs.length === 0) {
    return (
      <div className="p-8 text-center text-gray-500">
        <p className="mb-2">No news briefs yet.</p>
        <p className="text-sm">Run <code className="bg-gray-100 px-1 rounded">cb process-news</code> to create one.</p>
      </div>
    );
  }

  return (
    <div className="divide-y divide-gray-200">
      {briefs.map((brief) => (
        <button
          key={brief.path}
          onClick={() => onSelect(brief)}
          className={`w-full text-left p-4 hover:bg-gray-50 transition-colors ${
            selectedPath === brief.path ? "bg-blue-50 border-l-4 border-blue-500" : ""
          } ${brief.read ? "opacity-60" : ""}`}
        >
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <h3 className={`truncate ${brief.read ? "font-normal text-gray-700" : "font-medium text-gray-900"}`}>
                {brief.title}
              </h3>
              {brief.byline ? (
                <p className="text-sm text-gray-600 mt-1 line-clamp-2">
                  {brief.byline}
                </p>
              ) : null}
            </div>
            <div className="flex-shrink-0 text-right">
              <time className="text-sm text-gray-500">
                {formatDate(brief.date)}
              </time>
              {!brief.read && (
                <span className="block mt-1 text-xs text-blue-600 font-medium">
                  New
                </span>
              )}
              {brief.read && brief.readReason === "expired" ? (
                <span className="block mt-1 text-xs text-gray-400">
                  Expired
                </span>
              ) : null}
            </div>
          </div>
        </button>
      ))}
    </div>
  );
}

export default NewsIndex;
