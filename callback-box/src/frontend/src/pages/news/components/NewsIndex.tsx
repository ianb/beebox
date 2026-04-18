/**
 * NewsIndex - List of news briefs with navigation.
 *
 * Shows briefs in reverse chronological order with title, date, and byline.
 * Unread briefs are shown with bold titles, read briefs are dimmer.
 */

import { useEffect } from "react";
import { trpc, type RouterOutput } from "../../../lib/trpc";
import { cbSource } from "../../../lib/source-tag";

export type BriefSummary = RouterOutput["briefs"]["list"]["briefs"][number];

interface NewsIndexProps {
  /** Called when user selects a brief */
  onSelect: (brief: BriefSummary) => void;
  /** Currently selected brief path */
  selectedPath?: string;
  /** Increment to trigger a refresh of the brief list */
  refreshKey?: number;
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
  const utils = trpc.useUtils();
  const briefsQuery = trpc.briefs.list.useQuery();

  // Refetch when refreshKey changes
  useEffect(() => {
    if (refreshKey !== undefined && refreshKey > 0) {
      utils.briefs.list.invalidate();
    }
  }, [refreshKey, utils.briefs.list]);

  const briefs = briefsQuery.data?.briefs;

  if (briefsQuery.isLoading) {
    return (
      <div className="p-8 text-center text-warm-600">
        Loading briefs...
      </div>
    );
  }

  if (briefsQuery.error) {
    return (
      <div className="p-8 text-center text-danger-dark">
        Error: {briefsQuery.error.message}
      </div>
    );
  }

  if (!briefs || briefs.length === 0) {
    return (
      <div className="p-8 text-center text-warm-600">
        <p className="mb-2">No news briefs yet.</p>
        <p className="text-sm">Run <code className="bg-warm-100 px-1 rounded">cb process-news</code> to create one.</p>
      </div>
    );
  }

  return (
    <div className="divide-y divide-warm-300">
      {briefs.map((brief) => (
        <button
          key={brief.path}
          onClick={() => onSelect(brief)}
          {...cbSource("card", brief.relativePath)}
          className={`w-full text-left p-4 hover:bg-warm-50 transition-colors ${
            selectedPath === brief.path ? "bg-info-50 border-l-4 border-primary" : ""
          } ${brief.read ? "opacity-60" : ""}`}
        >
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <h3 className={`truncate ${brief.read ? "font-normal text-warm-700" : "font-medium text-warm-900"}`}>
                {brief.title}
              </h3>
              {brief.byline ? (
                <p className="text-sm text-warm-700 mt-1 line-clamp-2">
                  {brief.byline}
                </p>
              ) : null}
            </div>
            <div className="flex-shrink-0 text-right">
              <time className="text-sm text-warm-600">
                {formatDate(brief.date)}
              </time>
              {!brief.read && (
                <span className="block mt-1 text-xs text-primary font-medium">
                  New
                </span>
              )}
              {brief.read && brief.readReason === "expired" ? (
                <span className="block mt-1 text-xs text-warm-500">
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
