/**
 * CommitDetail — commit-metadata tab and its trailer-chip building blocks.
 */

import { Markdown } from "./Markdown";
import type { HistoryCommit } from "../api";
import { useViewNavigate } from "../hooks/useViewNavigate";

const CONNECTOR_KEYS = [
  "Pulled-By",
  "Created-By",
  "Fetched-By",
  "Pushed-By",
  "Sent-By",
] as const;

function trailerValues(value: string | string[] | undefined): string[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

/**
 * Get trailer value as string (first value if array).
 */
export function trailerString(value: string | string[] | undefined): string | undefined {
  if (!value) return undefined;
  return Array.isArray(value) ? value[0] : value;
}

export function stripTrailers(body: string): string {
  const lines = body.split("\n");
  const filtered = lines.filter(
    (line) => !/^(Session|Phase|Triggered-By|Feedback-Source|Agent|Items-Processed):\s/.test(line)
  );
  return filtered.join("\n").trim();
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
  onFilterWorkflow?: (workflow: string) => void;
}

export function CommitTab({
  commit,
  bodyText,
  onFilterSession,
  onFilterConnector,
  onFilterWorkflow,
}: CommitTabProps) {
  const handleNavigate = useViewNavigate();
  const trailers = commit.trailers;
  const phase = trailerString(trailers?.Phase);
  const triggeredBy = trailerString(trailers?.["Triggered-By"]);
  const sessionId = trailerString(trailers?.Session);
  const workflow = trailerString(trailers?.Workflow);

  const connectorChips: { key: string; value: string }[] = [];
  if (trailers) {
    for (const key of CONNECTOR_KEYS) {
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
        {triggeredBy ? <TrailerChip label="" value={triggeredBy} /> : null}
      </div>
      {sessionId || workflow || connectorChips.length > 0 ? (
        <div className="flex items-center gap-1.5 mb-2 flex-wrap">
          {sessionId ? (
            <TrailerChip
              label="session"
              value={`${sessionId.slice(0, 8)}…`}
              title={onFilterSession ? `Show only this session (${sessionId})` : sessionId}
              onClick={onFilterSession ? () => onFilterSession(sessionId) : undefined}
            />
          ) : null}
          {workflow ? (
            <TrailerChip
              label="workflow"
              value={workflow}
              title={onFilterWorkflow ? `Filter to workflow "${workflow}"` : undefined}
              onClick={onFilterWorkflow ? () => onFilterWorkflow(workflow) : undefined}
            />
          ) : null}
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
