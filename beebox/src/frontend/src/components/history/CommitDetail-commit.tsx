/**
 * CommitDetail — commit-metadata tab and its trailer-chip building blocks.
 */

import {
  CONNECTOR_TRAILER_KEYS,
  commitStep,
  commitTriggers,
  trailerString,
  triggerLabel,
} from "@shared/commit-trailers";
import { Markdown } from "../Markdown";
import type { HistoryCommit } from "../../api";
import { useViewNavigate } from "../../hooks/useViewNavigate";

function trailerValues(value: string | string[] | undefined): string[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

/**
 * Phase badge with color coding.
 */
function PhaseBadge({ phase }: { phase: string }) {
  const colors: Record<string, string> = {
    triage: "bg-info-100 text-primary",
    analyze: "bg-warning-100 text-warning-dark",
    brief: "bg-success-100 text-success-dark",
  };

  return (
    <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${colors[phase] || "bg-warm-100 text-warm-700"}`}>
      {phase}
    </span>
  );
}

interface TrailerChipProps {
  label: string;
  value: string;
  onClick?: () => void;
  title?: string;
}

function TrailerChip({ label, value, onClick, title }: TrailerChipProps) {
  const base = "text-xs px-1.5 py-0.5 rounded inline-flex items-center gap-1";
  const display = label ? (
    <>
      <span className="text-warm-500">{label}:</span>
      <span className="font-medium">{value}</span>
    </>
  ) : (
    <span>{value}</span>
  );
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        title={title}
        className={`${base} bg-warm-100 text-warm-700 hover:bg-primary-50 hover:text-primary-dark transition-colors`}
      >
        {display}
      </button>
    );
  }
  return <span className={`${base} bg-warm-100 text-warm-700`}>{display}</span>;
}

interface CommitTabProps {
  commit: HistoryCommit;
  bodyText: string;
  onFilterSession?: (sessionId: string) => void;
  onFilterConnector?: (connector: string) => void;
  /** Scope the list to one trigger, by its `<kind>/<name>` id. */
  onFilterTrigger?: (triggerId: string) => void;
}

export function CommitTab({
  commit,
  bodyText,
  onFilterSession,
  onFilterConnector,
  onFilterTrigger,
}: CommitTabProps) {
  const handleNavigate = useViewNavigate();
  const trailers = commit.trailers;
  const phase = trailerString(trailers?.Phase);
  const triggers = commitTriggers(trailers);
  const step = commitStep(trailers);
  const sessionId = trailerString(trailers?.Session);

  const connectorChips: { key: string; value: string }[] = [];
  if (trailers) {
    for (const key of CONNECTOR_TRAILER_KEYS) {
      for (const value of trailerValues(trailers[key])) {
        connectorChips.push({ key, value });
      }
    }
  }

  return (
    <div className="p-4">
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <code className="text-xs bg-warm-100 px-1.5 py-0.5 rounded text-warm-700">
          {commit.hash.substring(0, 8)}
        </code>
        <span className="text-xs text-warm-500">
          {new Date(commit.date).toLocaleString()}
        </span>
        {phase ? <PhaseBadge phase={phase} /> : null}
      </div>
      {sessionId || triggers.length > 0 || step !== undefined || connectorChips.length > 0 ? (
        <div className="flex items-center gap-1.5 mb-2 flex-wrap">
          {sessionId ? (
            <TrailerChip
              label="chat"
              value={`${sessionId.slice(0, 8)}…`}
              title={onFilterSession ? `Show only this chat (${sessionId})` : sessionId}
              onClick={onFilterSession ? () => onFilterSession(sessionId) : undefined}
            />
          ) : null}
          {triggers.map((trigger) => (
            <TrailerChip
              key={trigger.id}
              label="triggered by"
              value={triggerLabel(trigger)}
              title={onFilterTrigger ? `Filter to ${triggerLabel(trigger)}` : undefined}
              onClick={onFilterTrigger ? () => onFilterTrigger(trigger.id) : undefined}
            />
          ))}
          {step === undefined ? null : <TrailerChip label="step" value={step} />}
          {connectorChips.map((c) => (
            <TrailerChip
              key={`${c.key}:${c.value}`}
              label={c.key.replace("-By", "").toLowerCase()}
              value={c.value}
              title={onFilterConnector ? `Filter to connector "${c.value}"` : undefined}
              onClick={onFilterConnector ? () => onFilterConnector(c.value) : undefined}
            />
          ))}
        </div>
      ) : null}
      <h1 className="font-medium text-warm-900">{commit.subject}</h1>
      {bodyText ? <div className="mt-2 prose prose-sm max-w-none text-warm-700">
          <Markdown onNavigate={handleNavigate}>{bodyText}</Markdown>
        </div> : null}
    </div>
  );
}
