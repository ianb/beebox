/**
 * Schedule overview — table of all scheduled scripts with status and recent ticks.
 */

import { useState } from "react";
import { trpc } from "../../lib/trpc";
import type { RouterOutput } from "../../lib/trpc";
import { cbSource } from "../../lib/source-tag";
import { Pre } from "../ui/Pre";

type ScheduleInfo = RouterOutput["scheduler"]["schedules"]["schedules"][number];
type SchedulerLogEntry = RouterOutput["scheduler"]["log"]["entries"][number];

interface ScheduleOverviewProps {
  schedules: ScheduleInfo[];
  recentTicks: SchedulerLogEntry[];
  loading?: boolean;
  error?: { message: string } | null;
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
  const cls = exceeded ? "text-danger-dark font-medium" : "text-warm-500";
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
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
        enabled ? "bg-success" : "bg-warm-300"
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

function TriggerButton({ name, enabled }: { name: string; enabled: boolean }) {
  const utils = trpc.useUtils();
  const mutation = trpc.scheduler.trigger.useMutation({
    onSuccess() {
      utils.scheduler.schedules.invalidate();
    },
    onError() {
      utils.scheduler.schedules.invalidate();
    },
  });

  return (
    <button
      onClick={() => mutation.mutate({ name })}
      disabled={mutation.isPending || !enabled}
      className={`px-1.5 py-0.5 text-xs rounded transition-colors ${
        mutation.isPending
          ? "bg-warm-200 text-warm-500"
          : "bg-warm-100 text-warm-700 hover:bg-warm-200"
      } ${!enabled ? "opacity-50 cursor-not-allowed" : ""}`}
      title={!enabled ? "Schedule is disabled" : `Run ${name} now`}
    >
      {mutation.isPending ? "..." : "Run"}
    </button>
  );
}

function ScheduleNameCell({ s }: { s: ScheduleInfo }) {
  return (
    <div className="flex items-center gap-2">
      <EnableToggle name={s.name} enabled={s.enabled} />
      <div>
        <span className="font-medium text-warm-900">{s.name}</span>
        {s.description ? (
          <span className="block text-xs text-warm-600">{s.description}</span>
        ) : null}
      </div>
    </div>
  );
}

function ScheduleRow({ s }: { s: ScheduleInfo }) {
  const [showError, setShowError] = useState(false);

  return (
    <>
      <tr className={!s.enabled ? "opacity-50" : ""} {...cbSource("schedule", s.name)}>
        <td className="py-2 pr-3">
          <ScheduleNameCell s={s} />
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
        <td className="py-2 pr-3">
          {s.missingRequirements && s.missingRequirements.length > 0 ? (
            <span className="text-warning text-xs" title={`Missing: ${s.missingRequirements.join(", ")}`}>
              &#9888; {s.missingRequirements.join(", ")}
            </span>
          ) : s.running ? (
            <RunningIndicator running={s.running} />
          ) : (
            <StatusIndicator lastResult={s.lastResult} lastError={s.lastError} onToggleError={() => setShowError(!showError)} />
          )}
        </td>
        <td className="py-2">
          <TriggerButton name={s.name} enabled={s.enabled} />
        </td>
      </tr>
      {showError && s.lastError ? (
        <tr>
          <td colSpan={5} className="pb-2 px-3">
            <Pre size="xs" error boxed scroll="sm">{s.lastError}</Pre>
          </td>
        </tr>
      ) : null}
    </>
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
            <th className="pb-2 font-medium" />
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
    <span className="text-warning text-xs font-medium" title={`Triggered by ${running.triggeredBy}`}>
      <span className="inline-block w-2 h-2 rounded-full bg-warning animate-pulse mr-1 align-middle" />
      running ({elapsed})
    </span>
  );
}

function StatusIndicator({ lastResult, lastError, onToggleError }: { lastResult: "success" | "failure" | null; lastError: string | null; onToggleError?: () => void }) {
  if (lastResult === "success") {
    return <span className="text-success text-xs">&#10003;</span>;
  }
  if (lastResult === "failure") {
    return (
      <button
        onClick={onToggleError}
        className="text-danger-dark text-xs text-left hover:underline"
        title={lastError ? "Click to expand error" : ""}
      >
        &#10007; {lastError ? <span className="text-warm-600">{lastError.substring(0, 60)}&#8230;</span> : null}
      </button>
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
      {tick.error ? <span className="text-danger-dark">{tick.error}</span> : null}
    </div>
  );
}

function TickResult({ result }: { result: NonNullable<SchedulerLogEntry["result"]> }) {
  if (result.ran > 0) {
    return <span className="text-success">{result.ran} ran</span>;
  }
  if (result.errors > 0) {
    return <span className="text-danger-dark">{result.errors} errors</span>;
  }
  return <span>all skipped</span>;
}

export function ScheduleOverview({ schedules, recentTicks, loading, error }: ScheduleOverviewProps) {
  const [showTicks, setShowTicks] = useState(false);

  if (loading) {
    return (
      <div className="card">
        <h3 className="text-sm font-semibold text-warm-700 mb-2">Schedules</h3>
        <p className="text-sm text-warm-500 animate-pulse">Loading...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card">
        <h3 className="text-sm font-semibold text-warm-700 mb-2">Schedules</h3>
        <p className="text-sm text-danger-dark">Failed to load: {error.message}</p>
      </div>
    );
  }

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
