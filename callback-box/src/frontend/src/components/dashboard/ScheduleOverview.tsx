/**
 * Schedule overview — table of all scheduled scripts with status and recent ticks.
 */

import { useState } from "react";
import { trpc } from "../../lib/trpc";
import type { RouterOutput } from "../../lib/trpc";

type ScheduleInfo = RouterOutput["scheduler"]["schedules"]["schedules"][number];
type SchedulerLogEntry = RouterOutput["scheduler"]["log"]["entries"][number];

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
  const cls = exceeded ? "text-red-600 font-medium" : "text-warm-500";
  return (
    <span className={`ml-1 ${cls}`} title={`${formatDurationMs(budget.usedMs)} used of ${formatDurationMs(budget.limitMs)} budget in ${formatDurationMs(budget.windowMs)} window`}>
      [{formatDurationMs(budget.usedMs)}/{formatDurationMs(budget.limitMs)}]
    </span>
  );
}

function EnableToggle({ name, enabled }: { name: string; enabled: boolean }) {
  const utils = trpc.useUtils();
  const mutation = trpc.scheduler.setEnabled.useMutation({
    onSuccess() {
      utils.scheduler.schedules.invalidate();
    },
  });

  return (
    <button
      onClick={() => mutation.mutate({ name, enabled: !enabled })}
      disabled={mutation.isPending}
      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
        enabled ? "bg-green-600" : "bg-warm-300"
      } ${mutation.isPending ? "opacity-50" : ""}`}
      title={enabled ? "Disable schedule" : "Enable schedule"}
    >
      <span
        className="inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform"
        style={{ transform: enabled ? "translateX(18px)" : "translateX(2px)" }}
      />
    </button>
  );
}

function ScheduleRow({ s }: { s: ScheduleInfo }) {
  return (
    <tr className={!s.enabled ? "opacity-50" : ""}>
      <td className="py-2 pr-3">
        <div className="flex items-center gap-2">
          <EnableToggle name={s.name} enabled={s.enabled} />
          <div>
            <span className="font-medium text-warm-900">{s.name}</span>
            {s.description ? (
              <span className="block text-xs text-warm-600">{s.description}</span>
            ) : null}
          </div>
        </div>
      </td>
      <td className="py-2 pr-3 text-warm-700 font-mono text-xs">
        {s.schedule}
        {s.onWakeup && s.scheduleType !== "wakeup-only" ? (
          <span className="ml-1 text-warm-500">+wakeup</span>
        ) : null}
        {s.notBefore ? (
          <span className="ml-1 text-warm-500">&ge;{s.notBefore}</span>
        ) : null}
        {s.budget ? <BudgetIndicator budget={s.budget} /> : null}
      </td>
      <td className="py-2 pr-3 text-warm-700 text-xs">
        {s.lastRun ? timeAgo(s.lastRun) : "never"}
      </td>
      <td className="py-2">
        {s.running ? (
          <RunningIndicator running={s.running} />
        ) : (
          <StatusIndicator lastResult={s.lastResult} lastError={s.lastError} />
        )}
      </td>
    </tr>
  );
}

function ScheduleTable({ schedules }: { schedules: ScheduleInfo[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-warm-600 border-b">
            <th className="pb-2 font-medium">Name</th>
            <th className="pb-2 font-medium">Schedule</th>
            <th className="pb-2 font-medium">Last Run</th>
            <th className="pb-2 font-medium">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-warm-200">
          {schedules.map((s) => (
            <ScheduleRow key={s.name} s={s} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RunningIndicator({ running }: { running: { startedAt: string; triggeredBy: string } }) {
  const elapsed = timeAgo(running.startedAt).replace(" ago", "");
  return (
    <span className="text-yellow-600 text-xs font-medium" title={`Triggered by ${running.triggeredBy}`}>
      <span className="inline-block w-2 h-2 rounded-full bg-yellow-500 animate-pulse mr-1 align-middle" />
      running ({elapsed})
    </span>
  );
}

function StatusIndicator({ lastResult, lastError }: { lastResult: "success" | "failure" | null; lastError: string | null }) {
  if (lastResult === "success") {
    return <span className="text-green-600 text-xs">&#10003;</span>;
  }
  if (lastResult === "failure") {
    return (
      <span className="text-red-600 text-xs" title={lastError ?? ""}>
        &#10007; {lastError ? <span className="text-warm-600">{lastError.substring(0, 40)}</span> : null}
      </span>
    );
  }
  return <span className="text-warm-500 text-xs">&mdash;</span>;
}

function TickEntry({ tick }: { tick: SchedulerLogEntry }) {
  const hasActivity = Boolean(tick.result && (tick.result.ran > 0 || tick.result.errors > 0));
  return (
    <div className={`flex items-center gap-2 ${hasActivity ? "text-warm-700" : "text-warm-500"}`}>
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
        <h3 className="text-sm font-semibold text-warm-700 mb-2">Schedules</h3>
        <p className="text-sm text-warm-500">No scheduled scripts in config/schedules/</p>
      </div>
    );
  }

  const skippedCount = recentTicks.filter(
    (t) => !t.result || (t.result.ran === 0 && t.result.errors === 0),
  ).length;

  return (
    <div className="card">
      <h3 className="text-sm font-semibold text-warm-700 mb-3">Schedules</h3>

      <ScheduleTable schedules={schedules} />

      {recentTicks.length > 0 ? (
        <div className="mt-3 pt-3 border-t">
          <button
            onClick={() => setShowTicks(!showTicks)}
            className="text-xs text-warm-600 hover:text-warm-700"
          >
            {showTicks ? "Hide" : "Show"} recent ticks ({recentTicks.length})
            {skippedCount > 0 && !showTicks ? (
              <span className="ml-1 text-warm-500">
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
