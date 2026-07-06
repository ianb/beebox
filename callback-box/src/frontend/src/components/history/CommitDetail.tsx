/**
 * CommitDetail - Right panel showing commit metadata, diff, and session log.
 * Uses a tabbed interface: Commit | Diff (N) | New (N) | Moved (N) | Session
 */

import { useState, useMemo } from "react";
import type { HistoryCommit } from "../../api";
import { trpc } from "../../lib/trpc";
import { cbSource } from "../../lib/source-tag";
import { SessionLog } from "./SessionLog";
import { MobileBackButton } from "../ui/MobileBackButton";
import { parseDiff } from "./CommitDetail-diff";
import { CommitTab, stripTrailers, trailerString } from "./CommitDetail-commit";
import { DiffTab, MovedTab, NewFilesTab } from "./CommitDetail-tabs";

interface CommitDetailProps {
  commit: HistoryCommit;
  /** If provided, renders a mobile-only back button at the top. Called when user dismisses. */
  onBack?: () => void;
  /** Scope the surrounding history list to this commit's session. */
  onFilterSession?: (sessionId: string) => void;
  /** Add this connector value to the active connector filter. */
  onFilterConnector?: (connector: string) => void;
  /** Add this workflow value to the active workflow filter. */
  onFilterWorkflow?: (workflow: string) => void;
}

// --- Session toggle ---

function SessionSection({ sessionId }: { sessionId: string }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border-t border-warm-200">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-4 py-2 text-xs text-warm-500 hover:text-warm-700 text-left"
      >
        {expanded ? "▾" : "▸"} Session log
      </button>
      {expanded ? <SessionLog sessionId={sessionId} /> : null}
    </div>
  );
}

// --- Section header ---

function SectionHeader({ label, count }: { label: string; count: number }) {
  return (
    <div className="px-4 py-1.5 bg-warm-50 border-b border-warm-200">
      <span className="text-xs font-medium text-warm-600">{label}</span>
      <span className="text-xs text-warm-400 ml-1">({count})</span>
    </div>
  );
}

// --- Main component ---

export function CommitDetail({
  commit,
  onBack,
  onFilterSession,
  onFilterConnector,
  onFilterWorkflow,
}: CommitDetailProps) {
  const sessionId = trailerString(commit.trailers?.Session);
  const bodyText = commit.body ? stripTrailers(commit.body) : "";

  const { data: diffData, isLoading: diffLoading } = trpc.history.diff.useQuery(
    { hash: commit.hash }
  );
  const diff = diffData?.diff ?? null;

  // Parse diff into categories
  const { editedFiles, newFiles, movedFiles, deletedFiles } = useMemo(() => {
    if (!diff) return { editedFiles: [], newFiles: [], movedFiles: [], deletedFiles: [] };
    const files = parseDiff(diff);
    return {
      movedFiles: files.filter((f) => f.meta.includes("moved") && !f.hunks.some((h) => h.trim())),
      newFiles: files.filter((f) => f.meta.includes("new file")),
      deletedFiles: files.filter((f) => f.meta.includes("deleted")),
      editedFiles: files.filter((f) =>
        !f.meta.includes("new file") && !f.meta.includes("deleted") &&
        !(f.meta.includes("moved") && !f.hunks.some((h) => h.trim()))
      ),
    };
  }, [diff]);

  return (
    <div className="h-full flex flex-col bg-white" {...cbSource("commit", commit.hash)}>
      {onBack ? <MobileBackButton label="Back to commits" onClick={onBack} /> : null}
      <div className="flex-1 overflow-auto" tabIndex={0} aria-label="Commit details">
      {/* Commit info */}
      <CommitTab
        commit={commit}
        bodyText={bodyText}
        onFilterSession={onFilterSession}
        onFilterConnector={onFilterConnector}
        onFilterWorkflow={onFilterWorkflow}
      />

      {/* Divider */}
      <div className="border-t-2 border-warm-200" />

      {/* Files */}
      {diffLoading ? (
        <div className="text-sm text-warm-500 italic p-4">Loading diff...</div>
      ) : null}

      {newFiles.length > 0 ? (
        <>
          <SectionHeader label="New" count={newFiles.length} />
          <NewFilesTab files={newFiles} hash={commit.hash} />
        </>
      ) : null}

      {editedFiles.length > 0 || deletedFiles.length > 0 ? (
        <>
          <SectionHeader label="Changed" count={editedFiles.length + deletedFiles.length} />
          <DiffTab files={[...editedFiles, ...deletedFiles]} hash={commit.hash} />
        </>
      ) : null}

      {movedFiles.length > 0 ? (
        <>
          <SectionHeader label="Moved" count={movedFiles.length} />
          <MovedTab files={movedFiles} />
        </>
      ) : null}

      {sessionId ? <SessionSection sessionId={sessionId} /> : null}
      </div>
    </div>
  );
}
