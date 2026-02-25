/**
 * Schedule overview — table of all scheduled scripts with status and recent ticks.
 */

import { useState } from "react";
import type { ScheduleInfo, SchedulerLogEntry } from "../../api";

interface ScheduleOverviewProps {
  schedules: ScheduleInfo[];
  recentTicks: SchedulerLogEntry[];
}

function timeAgo(dateStr: string): string {
  const elapsed = Date.now() - new Date(dateStr).getTime();
  const seconds = Math.floor(elapsed / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatDurationMs(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  return `${Math.round(ms / 60_000)}m`;
}

function BudgetIndicator({ budget }: { budget: { limitMs: number; windowMs: number; usedMs: number } }) {
  const exceeded = budget.usedMs >= budget.limitMs;
  const cls = exceeded ? "text-red-600 font-medium" : "text-gray-400";
  return (
    <span className={`ml-1 ${cls}`} title={`${formatDurationMs(budget.usedMs)} used of ${formatDurationMs(budget.limitMs)} budget in ${formatDurationMs(budget.windowMs)} window`}>
      [{formatDurationMs(budget.usedMs)}/{formatDurationMs(budget.limitMs)}]
    </span>
  );
}

function ScheduleRow({ s }: { s: ScheduleInfo }) {
  return (
    <tr className={!s.enabled ? "opacity-50" : ""}>
      <td className="py-2 pr-3">
        <span className="font-medium text-gray-900">{s.name}</span>
        {s.description ? (
          <span className="block text-xs text-gray-500">{s.description}</span>
        ) : null}
        {!s.enabled ? (
          <span className="ml-1 text-xs text-gray-400">(disabled)</span>
        ) : null}
      </td>
      <td className="py-2 pr-3 text-gray-600 font-mono text-xs">
        {s.schedule}
        {s.onWakeup && s.scheduleType !== "wakeup-only" ? (
          <span className="ml-1 text-gray-400">+wakeup</span>
        ) : null}
        {s.notBefore ? (
          <span className="ml-1 text-gray-400">&ge;{s.notBefore}</span>
        ) : null}
        {s.budget ? <BudgetIndicator budget={s.budget} /> : null}
      </td>
      <td className="py-2 pr-3 text-gray-600 text-xs">
        {s.lastRun ? timeAgo(s.lastRun) : "never"}
      </td>
      <td className="py-2">
        <StatusIndicator lastResult={s.lastResult} lastError={s.lastError} />
      </td>
    </tr>
  );
}

function ScheduleTable({ schedules }: { schedules: ScheduleInfo[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-gray-500 border-b">
            <th className="pb-2 font-medium">Name</th>
            <th className="pb-2 font-medium">Schedule</th>
            <th className="pb-2 font-medium">Last Run</th>
            <th className="pb-2 font-medium">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {schedules.map((s) => (
            <ScheduleRow key={s.name} s={s} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StatusIndicator({ lastResult, lastError }: { lastResult: "success" | "failure" | null; lastError: string | null }) {
  if (lastResult === "success") {
    return <span className="text-green-600 text-xs">&#10003;</span>;
  }
  if (lastResult === "failure") {
    return (
      <span className="text-red-600 text-xs" title={lastError ?? ""}>
        &#10007; {lastError ? <span className="text-gray-500">{lastError.substring(0, 40)}</span> : null}
      </span>
    );
  }
  return <span className="text-gray-400 text-xs">&mdash;</span>;
}

function TickEntry({ tick }: { tick: SchedulerLogEntry }) {
  const hasActivity = Boolean(tick.result && (tick.result.ran > 0 || tick.result.errors > 0));
  return (
    <div className={`flex items-center gap-2 ${hasActivity ? "text-gray-700" : "text-gray-400"}`}>
      <span className="font-mono">{new Date(tick.ts).toLocaleTimeString()}</span>
      {tick.result ? (
        <TickResult result={tick.result} />
      ) : null}
      {tick.error ? <span className="text-red-600">{tick.error}</span> : null}
    </div>
  );
}

function TickResult({ result }: { result: NonNullable<SchedulerLogEntry["result"]> }) {
  if (result.ran > 0) {
    return <span className="text-green-600">{result.ran} ran</span>;
  }
  if (result.errors > 0) {
    return <span className="text-red-600">{result.errors} errors</span>;
  }
  return <span>all skipped</span>;
}

export function ScheduleOverview({ schedules, recentTicks }: ScheduleOverviewProps) {
  const [showTicks, setShowTicks] = useState(false);

  if (schedules.length === 0) {
    return (
      <div className="card">
        <h3 className="text-sm font-semibold text-gray-700 mb-2">Schedules</h3>
        <p className="text-sm text-gray-400">No scheduled scripts in config/schedules/</p>
      </div>
    );
  }

  const skippedCount = recentTicks.filter(
    (t) => !t.result || (t.result.ran === 0 && t.result.errors === 0),
  ).length;

  return (
    <div className="card">
      <h3 className="text-sm font-semibold text-gray-700 mb-3">Schedules</h3>

      <ScheduleTable schedules={schedules} />

      {recentTicks.length > 0 ? (
        <div className="mt-3 pt-3 border-t">
          <button
            onClick={() => setShowTicks(!showTicks)}
            className="text-xs text-gray-500 hover:text-gray-700"
          >
            {showTicks ? "Hide" : "Show"} recent ticks ({recentTicks.length})
            {skippedCount > 0 && !showTicks ? (
              <span className="ml-1 text-gray-400">
                &middot; {skippedCount} all-skipped
              </span>
            ) : null}
          </button>

          {showTicks ? (
            <div className="mt-2 space-y-1 text-xs">
              {recentTicks.map((tick, i) => (
                <TickEntry key={i} tick={tick} />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
