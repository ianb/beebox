/**
 * SessionLog - Renders a Claude Code session chat log.
 */

import { useState, useMemo } from "react";
import type { SessionContentBlock } from "../api";
import { trpc } from "../lib/trpc";

interface SessionLogProps {
  sessionId: string;
}

/**
 * Render a single content block.
 */
function ContentBlock({ block }: { block: SessionContentBlock }) {
  const [expanded, setExpanded] = useState(false);

  if (block.type === "text") {
    return (
      <div className="whitespace-pre-wrap text-sm">{block.text}</div>
    );
  }

  if (block.type === "tool_use") {
    return (
      <div className="my-1">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1.5 text-xs font-mono text-warm-700 hover:text-warm-900 bg-warm-100 rounded px-2 py-1"
        >
          <span className={`transition-transform ${expanded ? "rotate-90" : ""}`}>
            &#9654;
          </span>
          <span className="font-semibold text-primary">{block.toolName}</span>
          <span className="text-warm-600 truncate max-w-[500px]">
            {block.inputSummary}
          </span>
        </button>
        {expanded && block.inputSummary ? <div className="ml-6 mt-1 text-xs font-mono text-warm-600 bg-warm-50 rounded p-2 whitespace-pre-wrap max-h-40 overflow-auto">
            {block.inputSummary}
          </div> : null}
      </div>
    );
  }

  if (block.type === "tool_result") {
    if (!expanded) {
      // Tool results are shown inline when the parent tool_use is expanded
      // But we also render them standalone for context
      return null;
    }
    return (
      <div className="ml-6 text-xs font-mono text-warm-600 bg-warm-50 rounded p-2 whitespace-pre-wrap max-h-60 overflow-auto">
        {block.resultSummary}
      </div>
    );
  }

  return null;
}

/**
 * Render a single session entry (user or assistant message).
 */
function EntryView({ entry }: { entry: { uuid: string; type: string; timestamp: string; content: SessionContentBlock[] } }) {
  const isUser = entry.type === "user";

  // Group tool_use and tool_result blocks together
  const groupedContent: SessionContentBlock[] = [];
  for (const block of entry.content) {
    // Skip standalone tool_result blocks (they're shown with their tool_use)
    if (block.type === "tool_result") continue;
    groupedContent.push(block);
  }

  return (
    <div className={`px-3 py-2 ${isUser ? "bg-info-50 border-l-2 border-primary-light" : ""}`}>
      <div className="flex items-center gap-2 mb-1">
        <span className={`text-xs font-medium ${isUser ? "text-primary" : "text-warm-600"}`}>
          {isUser ? "User" : "Assistant"}
        </span>
        <span className="text-xs text-warm-500">
          {new Date(entry.timestamp).toLocaleTimeString()}
        </span>
      </div>
      <div className="space-y-1">
        {groupedContent.map((block, i) => (
          <ContentBlock key={i} block={block} />
        ))}
      </div>
    </div>
  );
}

export function SessionLog({ sessionId }: SessionLogProps) {
  const { data, isLoading, hasNextPage, fetchNextPage, isFetchingNextPage } =
    trpc.history.sessionLog.useInfiniteQuery(
      { sessionId, limit: 100 },
      {
        getNextPageParam: (lastPage) => lastPage.nextCursor,
      }
    );

  const firstPage = data?.pages[0];
  const found = firstPage?.found ?? true;
  const total = firstPage?.total ?? 0;

  const entries = useMemo(
    () => data?.pages.flatMap((p) => p.entries) ?? [],
    [data]
  );

  const loading = isLoading || isFetchingNextPage;

  if (!found) {
    return (
      <div className="text-sm text-warm-500 italic p-3">
        Session log not found for {sessionId.substring(0, 8)}...
      </div>
    );
  }

  return (
    <div>
      <div className="text-xs text-warm-600 px-3 py-1 bg-warm-50 border-b">
        {total} messages in session {sessionId.substring(0, 8)}...
      </div>
      <div className="divide-y divide-warm-200">
        {entries.map((entry) => (
          <EntryView key={entry.uuid} entry={entry} />
        ))}
      </div>
      {loading ? <div className="p-3 text-sm text-warm-500">Loading...</div> : null}
      {hasNextPage && !loading ? <button
          // fetchNextPage's failure surfaces via the query's own error state.
          onClick={() => void fetchNextPage()}
          className="w-full p-2 text-sm text-primary hover:bg-info-50 border-t"
        >
          Load more ({total - entries.length} remaining)
        </button> : null}
    </div>
  );
}
