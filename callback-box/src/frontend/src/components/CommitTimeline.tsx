/**
 * CommitTimeline - Left panel showing commit list with session grouping.
 */

import { type HistoryCommit } from "../api";

interface CommitTimelineProps {
  commits: HistoryCommit[];
  selectedHash: string | null;
  onSelect: (commit: HistoryCommit) => void;
  onLoadMore: () => void;
  hasMore: boolean;
  loading: boolean;
  onCollapse?: () => void;
}

/**
 * Get trailer value as string (first value if array).
 */
function trailerString(value: string | string[] | undefined): string | undefined {
  if (!value) return undefined;
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Phase badge with color coding.
 */
function PhaseBadge({ phase }: { phase: string }) {
  const colors: Record<string, string> = {
    triage: "bg-blue-100 text-blue-700",
    analyze: "bg-amber-100 text-amber-700",
    brief: "bg-green-100 text-green-700",
    "process-feedback": "bg-purple-100 text-purple-700",
  };

  return (
    <span className={`text-[10px] px-1 py-0.5 rounded font-medium ${colors[phase] || "bg-gray-100 text-gray-600"}`}>
      {phase}
    </span>
  );
}

/**
 * Relative time display.
 */
function relativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - date.getTime();

  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;

  return date.toLocaleDateString();
}

/**
 * Group commits by session ID for visual grouping.
 */
interface CommitGroup {
  sessionId: string | null;
  commits: HistoryCommit[];
}

function groupBySession(commits: HistoryCommit[]): CommitGroup[] {
  const groups: CommitGroup[] = [];
  let currentGroup: CommitGroup | null = null;

  for (const commit of commits) {
    const sessionId = trailerString(commit.trailers?.Session) || null;

    if (currentGroup && currentGroup.sessionId === sessionId) {
      currentGroup.commits.push(commit);
    } else {
      currentGroup = { sessionId, commits: [commit] };
      groups.push(currentGroup);
    }
  }

  return groups;
}

/**
 * Single commit row in the timeline.
 */
function CommitRow({
  commit,
  isSelected,
  onSelect,
}: {
  commit: HistoryCommit;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const phase = trailerString(commit.trailers?.Phase);
  const triggeredBy = trailerString(commit.trailers?.["Triggered-By"]);

  return (
    <button
      onClick={onSelect}
      className={`w-full text-left px-3 py-2 hover:bg-gray-50 transition-colors ${
        isSelected ? "bg-blue-50 border-r-2 border-blue-500" : ""
      }`}
    >
      <div className="flex items-center gap-1.5 mb-0.5">
        <code className="text-[10px] text-gray-400">
          {commit.hash.substring(0, 7)}
        </code>
        <span className="text-[10px] text-gray-400">
          {relativeTime(commit.date)}
        </span>
        {phase && <PhaseBadge phase={phase} />}
      </div>
      <div className="text-sm text-gray-800 truncate">
        {commit.subject}
      </div>
      {triggeredBy && (
        <div className="text-[10px] text-gray-400 mt-0.5">
          triggered by {triggeredBy}
        </div>
      )}
    </button>
  );
}

export function CommitTimeline({
  commits,
  selectedHash,
  onSelect,
  onLoadMore,
  hasMore,
  loading,
  onCollapse,
}: CommitTimelineProps) {
  const groups = groupBySession(commits);

  return (
    <div className="h-full flex flex-col">
      <div className="px-3 py-2 border-b bg-gray-50 flex-shrink-0 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-medium text-gray-700">Commits</h2>
          <div className="text-xs text-gray-400">{commits.length} loaded</div>
        </div>
        {onCollapse && (
          <button
            onClick={onCollapse}
            className="p-1 hover:bg-gray-200 rounded text-gray-400 hover:text-gray-600"
            title="Collapse sidebar"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
            </svg>
          </button>
        )}
      </div>

      <div className="flex-1 overflow-auto divide-y divide-gray-100">
        {groups.map((group, gi) => {
          if (group.sessionId && group.commits.length > 1) {
            // Session group with visual indicator
            return (
              <div key={gi} className="border-l-2 border-indigo-200 ml-1">
                <div className="px-3 py-1 bg-indigo-50/50 text-[10px] text-indigo-500 font-medium">
                  Session {group.sessionId.substring(0, 8)}...
                  <span className="text-indigo-400 ml-1">
                    ({group.commits.length} commits)
                  </span>
                </div>
                {group.commits.map((commit) => (
                  <CommitRow
                    key={commit.hash}
                    commit={commit}
                    isSelected={commit.hash === selectedHash}
                    onSelect={() => onSelect(commit)}
                  />
                ))}
              </div>
            );
          }

          // Ungrouped commits or single-commit sessions
          return group.commits.map((commit) => (
            <CommitRow
              key={commit.hash}
              commit={commit}
              isSelected={commit.hash === selectedHash}
              onSelect={() => onSelect(commit)}
            />
          ));
        })}

        {loading && (
          <div className="p-3 text-sm text-gray-400 text-center">Loading...</div>
        )}

        {hasMore && !loading && (
          <button
            onClick={onLoadMore}
            className="w-full p-2 text-sm text-blue-600 hover:bg-blue-50"
          >
            Load more commits
          </button>
        )}

        {!loading && commits.length === 0 && (
          <div className="p-4 text-sm text-gray-400 text-center">
            No commits found
          </div>
        )}
      </div>
    </div>
  );
}
