/**
 * A schedule's last few runs as a row of dots, oldest to newest: the rhythm at
 * a glance. Filled green ran, red failed, amber waited or was inconclusive,
 * a small grey dot found nothing to do; a ring marks a run whose summary asked
 * for attention. Each dot's tooltip says when and how; the panel has the rest.
 */

import type { RouterOutput } from "../../../lib/trpc/client";
import { cn } from "../../../lib/cn";
import { idleLabel } from "./idle";

type StripRun = RouterOutput["scheduler"]["schedules"]["schedules"][number]["runStrip"][number];

function describe(run: StripRun): { label: string; dot: string } {
  const idle = idleLabel(run.result, run.deferReason);
  if (idle !== null) return { label: idle, dot: "w-1.5 h-1.5 bg-warm-300" };
  const byResult: Record<StripRun["result"], { label: string; dot: string }> = {
    success: { label: "ran", dot: "w-2 h-2 bg-success" },
    failure: { label: "failed", dot: "w-2 h-2 bg-danger" },
    deferred: { label: "waiting", dot: "w-2 h-2 bg-warning" },
    inconclusive: { label: "inconclusive", dot: "w-2 h-2 border border-warning" },
  };
  return byResult[run.result];
}

export function RunStrip({ runs }: { runs: StripRun[] }) {
  if (runs.length === 0) return null;
  const described = runs.map((run) => ({ run, ...describe(run) }));
  const spoken = described.map((d) => `${d.label}${d.run.attention ? " (attention)" : ""}`).join(", ");
  return (
    <span role="img" aria-label={`Last ${String(runs.length)} runs, oldest first: ${spoken}`} className="flex items-center gap-1 mt-1">
      {described.map(({ run, label, dot }) => (
        <span
          key={run.ts}
          title={`${new Date(run.ts).toLocaleString()}: ${label}${run.attention ? ", attention" : ""}`}
          className={cn("inline-block rounded-full", dot, run.attention && "ring-1 ring-warning ring-offset-1")}
        />
      ))}
    </span>
  );
}
