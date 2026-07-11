/**
 * CommitTimeline - Commit list with session grouping.
 *
 * Renders inside a Sidebar container. Shows commits grouped by session ID
 * with phase badges, relative times, and duration between commits.
 */

import { type HistoryCommit } from "../../api";
import { cbSource } from "../../lib/source-tag";
import { Badge, type BadgeTone } from "../ui/Badge";

interface CommitTimelineProps {
  commits: HistoryCommit[];
  selectedHash: string | null;
  onSelect: (commit: HistoryCommit) => void;
  onLoadMore: () => void;
  hasMore: boolean;
  loading: boolean;
  /** Filter the list to a single session. If unset, session headers are static labels. */
  onFilterSession?: (sessionId: string) => void;
  /** Currently active session filter; used to suppress the filter affordance when already scoped. */
  activeSession?: string | null;
}

/**
 * Get trailer value as string (first value if array).
 */
function trailerString(value: string | string[] | undefined): string | undefined {
  if (!value) return undefined;
  return Array.isArray(value) ? value[0] : value;
}

const PHASE_TONE: Record<string, BadgeTone> = {
  intake: "info",
  transcribe: "info",
  "describe-images": "info",
  summarize: "warning",
  "plan-extraction": "warning",
  assemble: "warning",
  extract: "warning",
  archive: "success",
  refresh: "info",
};

function PhaseBadge({ phase }: { phase: string }) {
  return <Badge tone={PHASE_TONE[phase] ?? "neutral"} size="sm">{phase}</Badge>;
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
 * Colored pill badges: "add N", "del N", "+X-Y in N" for modified files.
 */
function FileStatBadges({ stat }: { stat: { added: number; modified: number; deleted: number; renamed: number; insertions: number; deletions: number } }) {
  return (
    <>
      {stat.added > 0 ? (
        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-success-100 text-success-dark font-medium">
          add {stat.added}
        </span>
      ) : null}
      {stat.modified > 0 ? (
        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-warning-100 text-warning-dark font-medium">
          {stat.insertions > 0 || stat.deletions > 0
            ? `+${stat.insertions}-${stat.deletions} in ${stat.modified}`
            : `mod ${stat.modified}`}
        </span>
      ) : null}
      {stat.renamed > 0 ? (
        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 font-medium">
          mv {stat.renamed}
        </span>
      ) : null}
      {stat.deleted > 0 ? (
        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-danger-100 text-danger-dark font-medium">
          del {stat.deleted}
        </span>
      ) : null}
    </>
  );
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

  const ariaLabel = [
    `Commit ${commit.hash.substring(0, 7)}`,
    commit.subject,
    relativeTime(commit.date),
    phase ? `phase ${phase}` : null,
    triggeredBy ? `triggered by ${triggeredBy}` : null,
  ].filter((v): v is string => v !== null).join(", ");

  return (
    <button
      onClick={onSelect}
      {...cbSource("commit", commit.hash)}
      aria-label={ariaLabel}
      aria-current={isSelected ? "true" : undefined}
      className={`w-full text-left px-3 py-2 hover:bg-warm-50 transition-colors ${
        isSelected ? "bg-info-50 border-r-2 border-primary" : ""
      }`}
    >
      <div className="flex items-center gap-1.5 mb-0.5">
        <code className="text-[10px] text-warm-500">
          {commit.hash.substring(0, 7)}
        </code>
        <span className="text-[10px] text-warm-500">
          {relativeTime(commit.date)}
        </span>
        {phase ? <PhaseBadge phase={phase} /> : null}
        {duration ? <span className="text-[10px] text-warm-500 font-mono">{duration}</span> : null}
      </div>
      <div className="text-sm text-warm-800 truncate">
        {commit.subject}
      </div>
      <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
        {commit.fileStat ? <FileStatBadges stat={commit.fileStat} /> : null}
        {triggeredBy ? <span className="text-[10px] text-warm-500">
            {triggeredBy}
          </span> : null}
      </div>
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
  onFilterSession,
  activeSession,
}: CommitTimelineProps) {
  const groups = groupBySession(commits);

  // Build a map of commit hash -> previous commit date (earlier in time).
  // commits is reverse chronological, so commits[i+1] is earlier than commits[i].
  const prevDateMap = new Map<string, string>();
  for (const [i, commit] of commits.entries()) {
    const next = commits[i + 1];
    if (next !== undefined) prevDateMap.set(commit.hash, next.date);
  }

  return (
    <div className="divide-y divide-warm-200">
      {groups.map((group, gi) => {
        if (group.sessionId && group.commits.length > 1) {
          const sessionId = group.sessionId;
          const isActive = activeSession === sessionId;
          const canFilter = onFilterSession !== undefined && !isActive;
          const headerClasses =
            "w-full text-left px-3 py-1 bg-indigo-50/50 text-[10px] text-indigo-500 font-medium flex items-baseline gap-1";
          const headerContent = (
            <>
              <span>Session {sessionId.substring(0, 8)}...</span>
              <span className="text-indigo-400">({group.commits.length} commits)</span>
              {canFilter ? (
                <span className="ml-auto text-indigo-400">show only →</span>
              ) : null}
            </>
          );
          return (
            <div key={gi} className="border-l-2 border-indigo-200 ml-1">
              {canFilter ? (
                <button
                  type="button"
                  onClick={() => onFilterSession(sessionId)}
                  className={`${headerClasses} hover:bg-indigo-100/50 transition-colors`}
                >
                  {headerContent}
                </button>
              ) : (
                <div className={headerClasses}>{headerContent}</div>
              )}
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

      {loading ? <div className="p-3 text-sm text-warm-500 text-center">Loading...</div> : null}

      {hasMore && !loading ? <button
          onClick={onLoadMore}
          className="w-full p-2 text-sm text-primary hover:bg-info-50"
        >
          Load more commits
        </button> : null}

      {!loading && commits.length === 0 && (
        <div className="p-4 text-sm text-warm-500 text-center">
          No commits found
        </div>
      )}
    </div>
  );
}
