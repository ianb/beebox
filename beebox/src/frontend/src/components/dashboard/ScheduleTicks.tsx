/**
 * The recent-ticks list under the schedule table.
 *
 * A tick has three kinds of outcome, not two: scripts that ran, scripts that
 * errored, and scripts whose work ran but whose check reached no verdict
 * (`inconclusive` — `shared/inconclusive.ts`). The third one is why this lives
 * in its own file: it has to read as neither green nor red, and it has to
 * count as *activity*, or a tick where the only thing that happened was an
 * unjudged run gets filed under "all skipped" and disappears.
 */

import type { RouterOutput } from "../../lib/trpc";

type SchedulerLogEntry = RouterOutput["scheduler"]["log"]["entries"][number];
type TickResultData = NonNullable<SchedulerLogEntry["result"]>;

/** Whether anything happened in this tick — an unjudged run counts. */
export function tickHadActivity(tick: SchedulerLogEntry): boolean {
  const result = tick.result;
  if (!result) return false;
  return result.ran > 0 || result.errors > 0 || result.inconclusive > 0;
}

/** How many of these ticks did nothing at all. */
export function quietTickCount(ticks: SchedulerLogEntry[]): number {
  return ticks.filter((t) => !tickHadActivity(t)).length;
}

/**
 * The counts for one tick. Each non-zero kind gets its own span so an
 * inconclusive run is never absorbed into the green "ran" number.
 */
function TickResult({ result }: { result: TickResultData }) {
  const parts = [
    result.ran > 0 ? <span key="ran" className="text-success">{result.ran} ran</span> : null,
    result.inconclusive > 0 ? (
      <span key="inconclusive" className="text-warm-600" title="Work ran; the check reached no verdict">
        ? {result.inconclusive} inconclusive
      </span>
    ) : null,
    result.errors > 0 ? (
      <span key="errors" className="text-danger-dark">{result.errors} errors</span>
    ) : null,
  ].filter((p) => p !== null);

  if (parts.length === 0) return <span>all skipped</span>;
  return <span className="flex items-center gap-2">{parts}</span>;
}

function TickEntry({ tick }: { tick: SchedulerLogEntry }) {
  const active = tickHadActivity(tick);
  return (
    <div className={`flex items-center gap-2 ${active ? "text-warm-700" : "text-warm-500"}`}>
      <span className="font-mono">{new Date(tick.ts).toLocaleTimeString()}</span>
      {tick.result ? <TickResult result={tick.result} /> : null}
      {tick.error ? <span className="text-danger-dark">{tick.error}</span> : null}
    </div>
  );
}

export function TickList({ ticks }: { ticks: SchedulerLogEntry[] }) {
  return (
    <div className="mt-2 space-y-1 text-xs">
      {ticks.map((tick, i) => (
        <TickEntry key={i} tick={tick} />
      ))}
    </div>
  );
}
