/**
 * CommitTimeline - Commit list with session grouping.
 *
 * Renders inside a Sidebar container. Shows commits grouped by session ID
 * with phase badges, relative times, and duration between commits.
 */

import { type HistoryCommit } from "../api";

interface CommitTimelineProps {
  commits: HistoryCommit[];
  selectedHash: string | null;
  onSelect: (commit: HistoryCommit) => void;
  onLoadMore: () => void;
  hasMore: boolean;
  loading: boolean;
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
    fetch: "bg-cyan-100 text-cyan-700",
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
 * Format duration between two dates as MM:SS.
 */
function formatDuration(fromDate: string, toDate: string): string | null {
  const from = new Date(fromDate).getTime();
  const to = new Date(toDate).getTime();
  const diff = to - from;
  if (diff < 0 || diff > 3600000) return null; // Skip if negative or > 1 hour
  const minutes = Math.floor(diff / 60000);
  const seconds = Math.floor((diff % 60000) / 1000);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

/**
 * Single commit row in the timeline.
 */
function CommitRow({
  commit,
  isSelected,
  onSelect,
  prevCommitDate,
}: {
  commit: HistoryCommit;
  isSelected: boolean;
  onSelect: () => void;
  /** Date of the previous commit (earlier in time) to compute duration */
  prevCommitDate?: string;
}) {
  const phase = trailerString(commit.trailers?.Phase);
  const triggeredBy = trailerString(commit.trailers?.["Triggered-By"]);
  const duration = prevCommitDate ? formatDuration(prevCommitDate, commit.date) : null;

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
        {duration && (
          <span className="text-[10px] text-gray-400 font-mono">{duration}</span>
        )}
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
}: CommitTimelineProps) {
  const groups = groupBySession(commits);

  // Build a map of commit hash -> previous commit date (earlier in time).
  // commits is reverse chronological, so commits[i+1] is earlier than commits[i].
  const prevDateMap = new Map<string, string>();
  for (let i = 0; i < commits.length - 1; i++) {
    prevDateMap.set(commits[i]!.hash, commits[i + 1]!.date);
  }

  return (
    <div className="divide-y divide-gray-100">
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
                  prevCommitDate={prevDateMap.get(commit.hash)}
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
            prevCommitDate={prevDateMap.get(commit.hash)}
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
  );
}
