/**
 * A schedule's recent runs, newest first: when and how each ended, and the
 * summary the task wrote about itself (headline, Markdown body, notes behind
 * a disclosure). Machine-local and capped at the last 20 runs
 * (`core/schedule/summary.ts`).
 */

import { trpc } from "../../../lib/trpc/client";
import type { RouterOutput } from "../../../lib/trpc/client";
import { bbxSource } from "../../../lib/source-tag";
import { Badge } from "../../ui/Badge";
import { FriendlyDate } from "../../ui/FriendlyDate";
import { Pre } from "../../ui/Pre";
import { Markdown } from "../../Markdown/body";
import { conciseScheduleError } from "@shared/schedule-error";
import { useViewNavigate } from "../../../hooks/useViewNavigate";
import { idleLabel } from "./idle";

type RunEntry = RouterOutput["scheduler"]["runs"]["runs"][number];

const RESULT_LABEL: Record<RunEntry["result"], string> = {
  success: "ran",
  failure: "failed",
  deferred: "waiting",
  inconclusive: "inconclusive",
};

const TRIGGER_LABEL: Record<string, string> = {
  schedule: "on schedule",
  wakeup: "on wakeup",
  "webapp-trigger": "run now",
};

function RunItem({ run }: { run: RunEntry }) {
  const { summary } = run;
  // A summary may link to the cards it changed.
  const onNavigate = useViewNavigate();
  const idle = idleLabel(run.result, run.deferReason);
  return (
    <li className="py-2">
      <div className="flex flex-wrap items-baseline gap-2 text-xs text-warm-600">
        <FriendlyDate iso={run.ts} />
        <span>{idle ?? RESULT_LABEL[run.result]}</span>
        <span>{TRIGGER_LABEL[run.triggeredBy] ?? run.triggeredBy}</span>
        {summary ? <Badge tone={summary.priority === "attention" ? "warning" : "neutral"} size="sm">{summary.priority}</Badge> : null}
      </div>
      {summary ? (
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
      ) : run.result === "success" ? (
        <p className="mt-1 text-xs text-warm-500">No summary</p>
      ) : null}
      {run.error && run.result !== "success" && idle === null ? (
        <Pre size="xs" error={run.result === "failure"} boxed scroll="sm" className="mt-1">{conciseScheduleError(run.error)}</Pre>
      ) : null}
    </li>
  );
}

export function RunHistory({ name }: { name: string }) {
  const query = trpc.scheduler.runs.useQuery({ name });
  if (query.isPending) return <p className="text-xs text-warm-500 animate-pulse">Loading runs...</p>;
  if (query.error) return <p className="text-xs text-danger-dark">Could not load runs: {query.error.message}</p>;
  if (query.data.runs.length === 0) return <p className="text-xs text-warm-500">No runs recorded on this machine yet.</p>;
  return (
    <ul className="divide-y divide-warm-100" aria-label={`Recent runs of ${name}`} {...bbxSource("schedule", name)}>
      {query.data.runs.map((run) => <RunItem key={run.ts} run={run} />)}
    </ul>
  );
}
