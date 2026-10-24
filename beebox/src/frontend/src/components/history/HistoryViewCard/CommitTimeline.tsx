/**
 * CommitTimeline - Commit list with session grouping.
 *
 * Renders inside a Sidebar container. Shows commits grouped by session ID
 * with phase badges, relative times, and duration between commits.
 */

import {
  commitStep,
  commitTriggers,
  trailerString,
  triggerLabel,
} from "@shared/commit-trailers";
import { type HistoryCommit } from "../../../api";
import { bbxSource } from "../../../lib/source-tag";
import { Badge } from "../../ui/Badge";
import { StatusMessage } from "../../ui/StatusMessage";
import { phaseTone } from "../phase-tone";
import { useBoxNow } from "../../../lib/box-clock";
import { agoOnClock } from "../../../lib/relative-time";

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
  idPrefix: string;
}

function PhaseBadge({ phase }: { phase: string }) {
  return <Badge tone={phaseTone(phase)} size="sm">{phase}</Badge>;
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
 * Tone badges: "add N", "del N", "+X-Y in N" for modified files.
 */
function FileStatBadges({ stat }: { stat: { added: number; modified: number; deleted: number; renamed: number; insertions: number; deletions: number } }) {
  return (
    <>
      {stat.added > 0 ? (
        <Badge tone="success" size="sm">
          add {stat.added}
        </Badge>
      ) : null}
      {stat.modified > 0 ? (
        <Badge tone="warning" size="sm">
          {stat.insertions > 0 || stat.deletions > 0
            ? `+${stat.insertions}-${stat.deletions} in ${stat.modified}`
            : `mod ${stat.modified}`}
        </Badge>
      ) : null}
      {stat.renamed > 0 ? (
        <Badge tone="info" size="sm">
          mv {stat.renamed}
        </Badge>
      ) : null}
      {stat.deleted > 0 ? (
        <Badge tone="danger" size="sm">
          del {stat.deleted}
        </Badge>
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
  // Every trigger convention, not just `Triggered-By`: a procedure or trick
  // commit that badged nothing read as a hand edit, which is the one
  // distinction this timeline exists to draw.
  const triggers = commitTriggers(commit.trailers);
  const step = commitStep(commit.trailers);
  const duration = prevCommitDate ? formatDuration(prevCommitDate, commit.date) : null;

  const ariaLabel = [
    `Commit ${commit.hash.substring(0, 7)}`,
    commit.subject,
    agoOnClock(commit.date, "box"),
    phase ? `phase ${phase}` : null,
    ...triggers.map((trigger) => `triggered by ${triggerLabel(trigger)}`),
    step === undefined ? null : `step ${step}`,
  ].filter((v): v is string => v !== null).join(", ");

  return (
    <button
      onClick={onSelect}
      {...bbxSource("commit", commit.hash)}
      aria-label={ariaLabel}
      aria-current={isSelected ? "true" : undefined}
      className={`w-full text-left px-3 py-2 hover:bg-warm-50 transition-colors ${
        isSelected ? "bg-info-50 border-r-2 border-primary" : ""
      }`}
    >
      <div className="flex items-center gap-1.5 mb-0.5">
        <code className="text-[10px] text-warm-700">
          {commit.hash.substring(0, 7)}
        </code>
        <span className="text-[10px] text-warm-700">
          {agoOnClock(commit.date, "box")}
        </span>
        {phase ? <PhaseBadge phase={phase} /> : null}
        {duration ? <span className="text-[10px] text-warm-700 font-mono">{duration}</span> : null}
      </div>
      <div className="text-sm text-warm-800 truncate">
        {commit.subject}
      </div>
      <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
        {commit.fileStat ? <FileStatBadges stat={commit.fileStat} /> : null}
        {triggers.map((trigger) => (
          <span key={trigger.id} className="text-[10px] text-warm-700">
            {triggerLabel(trigger)}
          </span>
        ))}
        {step === undefined ? null : (
          <span className="text-[10px] text-warm-700">step {step}</span>
        )}
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
  idPrefix,
}: CommitTimelineProps) {
  // Re-render each minute so the commit ages stay current.
  useBoxNow(60_000);
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

      {loading ? <StatusMessage>Loading...</StatusMessage> : null}

      {hasMore && !loading ? <button
          id={`${idPrefix}-load-more`}
          onClick={onLoadMore}
          className="w-full p-2 text-sm text-primary hover:bg-info-50"
        >
          Load more commits
        </button> : null}

      {!loading && commits.length === 0 && (
        <div className="p-4 text-sm text-warm-700 text-center">
          No commits found
        </div>
      )}
    </div>
  );
}
