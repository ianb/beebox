/**
 * SessionLog - Renders a Claude Code session chat log.
 */

import { useState, useEffect, useCallback } from "react";
import { getSessionLog, type SessionEntry, type SessionContentBlock } from "../api";

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
          className="flex items-center gap-1.5 text-xs font-mono text-gray-600 hover:text-gray-900 bg-gray-100 rounded px-2 py-1"
        >
          <span className={`transition-transform ${expanded ? "rotate-90" : ""}`}>
            &#9654;
          </span>
          <span className="font-semibold text-blue-700">{block.toolName}</span>
          <span className="text-gray-500 truncate max-w-[500px]">
            {block.inputSummary}
          </span>
        </button>
        {expanded && block.inputSummary && (
          <div className="ml-6 mt-1 text-xs font-mono text-gray-500 bg-gray-50 rounded p-2 whitespace-pre-wrap max-h-40 overflow-auto">
            {block.inputSummary}
          </div>
        )}
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
      <div className="ml-6 text-xs font-mono text-gray-500 bg-gray-50 rounded p-2 whitespace-pre-wrap max-h-60 overflow-auto">
        {block.resultSummary}
      </div>
    );
  }

  return null;
}

/**
 * Render a single session entry (user or assistant message).
 */
function EntryView({ entry }: { entry: SessionEntry }) {
  const isUser = entry.type === "user";

  // Group tool_use and tool_result blocks together
  const groupedContent: SessionContentBlock[] = [];
  for (const block of entry.content) {
    // Skip standalone tool_result blocks (they're shown with their tool_use)
    if (block.type === "tool_result") continue;
    groupedContent.push(block);
  }

  // Find tool results for each tool use
  const toolResults = new Map<string, SessionContentBlock>();
  for (const block of entry.content) {
    if (block.type === "tool_result" && block.toolUseId) {
      toolResults.set(block.toolUseId, block);
    }
  }

  return (
    <div className={`px-3 py-2 ${isUser ? "bg-blue-50 border-l-2 border-blue-300" : ""}`}>
      <div className="flex items-center gap-2 mb-1">
        <span className={`text-xs font-medium ${isUser ? "text-blue-600" : "text-gray-500"}`}>
          {isUser ? "User" : "Assistant"}
        </span>
        <span className="text-xs text-gray-400">
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
  const [entries, setEntries] = useState<SessionEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(0);
  const [found, setFound] = useState(true);

  const loadEntries = useCallback(async (offset = 0) => {
    try {
      setLoading(true);
      const result = await getSessionLog({ sessionId, offset, limit: 100 });
      setFound(result.found);
      if (offset === 0) {
        setEntries(result.entries);
      } else {
        setEntries((prev) => [...prev, ...result.entries]);
      }
      setHasMore(result.hasMore);
      setTotal(result.total);
    } catch (err) {
      console.error("Failed to load session log:", err);
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    loadEntries(0);
  }, [loadEntries]);

  if (!found) {
    return (
      <div className="text-sm text-gray-400 italic p-3">
        Session log not found for {sessionId.substring(0, 8)}...
      </div>
    );
  }

  return (
    <div>
      <div className="text-xs text-gray-500 px-3 py-1 bg-gray-50 border-b">
        {total} messages in session {sessionId.substring(0, 8)}...
      </div>
      <div className="divide-y divide-gray-100">
        {entries.map((entry) => (
          <EntryView key={entry.uuid} entry={entry} />
        ))}
      </div>
      {loading && (
        <div className="p-3 text-sm text-gray-400">Loading...</div>
      )}
      {hasMore && !loading && (
        <button
          onClick={() => loadEntries(entries.length)}
          className="w-full p-2 text-sm text-blue-600 hover:bg-blue-50 border-t"
        >
          Load more ({total - entries.length} remaining)
        </button>
      )}
    </div>
  );
}
