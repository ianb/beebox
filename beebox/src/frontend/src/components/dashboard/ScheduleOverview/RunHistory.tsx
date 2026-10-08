/**
 * A schedule's recent runs, newest first: when and how each ended, and the
 * summary the task wrote about itself (headline, Markdown body, notes behind
 * a disclosure). Machine-local and capped at the last 20 runs
 * (`core/schedule/summary.ts`).
 */

import { trpc } from "../../../lib/trpc/client";
import type { RouterOutput } from "../../../lib/trpc/client";
import { bbxSource } from "../../../lib/source-tag";
import { Badge, type BadgeTone } from "../../ui/Badge";
import { FriendlyDate } from "../../ui/FriendlyDate";
import { Pre } from "../../ui/Pre";
import { Markdown } from "../../Markdown/body";
import { conciseScheduleError } from "@shared/schedule-error";
import { useViewNavigate } from "../../../hooks/useViewNavigate";
import { deferText, idleLabel } from "./idle";

type RunEntry = RouterOutput["scheduler"]["runs"]["runs"][number];

/** How a run ended, as a labelled badge. A deferral that found nothing to do is its own quiet outcome. */
function outcome(run: RunEntry): { label: string; tone: BadgeTone } {
  const idle = idleLabel(run.result, run.deferReason);
  if (idle !== null) return { label: idle, tone: "neutral" };
  const byResult: Record<RunEntry["result"], { label: string; tone: BadgeTone }> = {
    success: { label: "ran", tone: "success" },
    failure: { label: "failed", tone: "danger" },
    deferred: { label: "waiting", tone: "warning" },
    inconclusive: { label: "inconclusive", tone: "warning" },
  };
  return byResult[run.result];
}

const TRIGGER_LABEL: Record<string, string> = {
  schedule: "on schedule",
  wakeup: "on wakeup",
  "webapp-trigger": "run by hand",
};

function Label({ children }: { children: string }) {
  return <span className="text-[10px] uppercase tracking-wide text-warm-500">{children}</span>;
}

/** Why a run without a summary ended as it did; failures keep their full output one click away. */
function RunReason({ run }: { run: RunEntry }) {
  if (run.error === undefined || run.result === "success" || idleLabel(run.result, run.deferReason) !== null) return null;
  const reason = deferText(conciseScheduleError(run.error), run.deferReason);
  return (
    <div className="mt-1 text-xs text-warm-800">
      <Label>Reason</Label> {reason}
      {run.result === "failure" && run.error.trim() !== reason ? (
        <details className="mt-1">
          <summary className="cursor-pointer text-warm-600">Full output</summary>
          <Pre size="xs" error boxed scroll="sm" className="mt-1">{run.error}</Pre>
        </details>
      ) : null}
    </div>
  );
}

function RunSummaryBlock({ summary }: { summary: NonNullable<RunEntry["summary"]> }) {
  // A summary may link to the cards it changed.
  const onNavigate = useViewNavigate();
  return (
    <div className="mt-1 text-sm text-warm-900">
      <p className="font-medium">{summary.headline}</p>
      {summary.body ? <Markdown prose="block" onNavigate={onNavigate}>{summary.body}</Markdown> : null}
      {summary.notes ? (
        <details className="mt-1 text-xs text-warm-700">
          <summary className="cursor-pointer text-warm-600">Notes</summary>
          <Markdown prose="block" onNavigate={onNavigate}>{summary.notes}</Markdown>
        </details>
      ) : null}
    </div>
  );
}

function RunItem({ run }: { run: RunEntry }) {
  const { summary } = run;
  const ended = outcome(run);
  return (
    <li className="py-2">
      <div className="flex flex-wrap items-center gap-2 text-xs text-warm-600">
        <Badge tone={ended.tone} size="sm">{ended.label}</Badge>
        <FriendlyDate iso={run.ts} />
        <span>&middot; {TRIGGER_LABEL[run.triggeredBy] ?? run.triggeredBy}</span>
        {summary?.priority === "attention" ? <Badge tone="warning" size="sm">attention</Badge> : null}
      </div>
      {summary ? <RunSummaryBlock summary={summary} /> : null}
      <RunReason run={run} />
    </li>
  );
}

function RunList({ name }: { name: string }) {
  const query = trpc.scheduler.runs.useQuery({ name });
  if (query.isPending) return <p className="text-xs text-warm-500 animate-pulse">Loading runs...</p>;
  if (query.error) return <p className="text-xs text-danger-dark">Could not load runs: {query.error.message}</p>;
  if (query.data.runs.length === 0) return <p className="text-xs text-warm-500">No runs recorded on this machine yet.</p>;
  return (
    <ul className="divide-y divide-warm-200" aria-label={`Recent runs of ${name}`}>
      {query.data.runs.map((run) => <RunItem key={run.ts} run={run} />)}
    </ul>
  );
}

/** The panel under a schedule's row: a labelled inset so it reads as belonging to that schedule. */
export function RunHistory({ name }: { name: string }) {
  return (
    <section className="ml-4 mb-2 rounded border-l-4 border-warm-300 bg-warm-50 px-3 py-2" {...bbxSource("schedule", name)}>
      <h3 className="text-xs font-semibold text-warm-700">Recent runs of {name}</h3>
      <RunList name={name} />
    </section>
  );
}
