/**
 * Schedule overview — table of all scheduled scripts with status and recent ticks.
 */

import { useState } from "react";
import { trpc } from "../../lib/trpc";
import type { RouterOutput } from "../../lib/trpc";
import { cbSource } from "../../lib/source-tag";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { InlineAction } from "../ui/InlineAction";
import { Pre } from "../ui/Pre";
import { Toggle } from "../ui/Toggle";
import { VisuallyHidden } from "../ui/VisuallyHidden";
import { ScheduleStatusIndicator } from "./ScheduleStatusIndicator";

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
      void utils.scheduler.schedules.invalidate();
    },
  });

  return (
    <Toggle
      checked={enabled}
      onChange={(next) => mutation.mutate({ name, enabled: next })}
      disabled={mutation.isPending}
      label={enabled ? "Disable schedule" : "Enable schedule"}
      className="shrink-0"
    />
  );
}

function TriggerButton({ name, enabled }: { name: string; enabled: boolean }) {
  const utils = trpc.useUtils();
  const mutation = trpc.scheduler.trigger.useMutation({
    onSuccess() {
      void utils.scheduler.schedules.invalidate();
    },
    onError() {
      void utils.scheduler.schedules.invalidate();
    },
  });

  return (
    <Button
      intent="secondary"
      size="sm"
      onClick={() => mutation.mutate({ name })}
      disabled={!enabled}
      loading={mutation.isPending}
      loadingLabel="..."
      title={!enabled ? "Schedule is disabled" : `Run ${name} now`}
    >
      Run
    </Button>
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

/** The raw schedule expression, kept reachable (as a tooltip) for editing/debugging. */
function rawScheduleTitle(s: ScheduleInfo): string {
  const parts = [s.schedule];
  if (s.onWakeup && s.scheduleType !== "wakeup-only") parts.push("+wakeup");
  if (s.notBefore) parts.push(`≥${s.notBefore}`);
  if (s.once) parts.push("once");
  if (s.until) parts.push(`until ${s.until}`);
  return parts.join(" ");
}

function ScheduleRow({ s }: { s: ScheduleInfo }) {
  const [showError, setShowError] = useState(false);

  return (
    <>
      <tr className={!s.enabled ? "opacity-50" : ""} {...cbSource("schedule", s.name)}>
        <td className="py-2 pr-3">
          <ScheduleNameCell s={s} />
        </td>
        <td className="py-2 pr-3 text-warm-700 text-xs">
          <span title={rawScheduleTitle(s)}>{s.cadence}</span>
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
            <ScheduleStatusIndicator lastResult={s.lastResult} lastError={s.lastError} onToggleError={() => setShowError(!showError)} />
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

function ScheduleTableHead() {
  return (
    <thead>
      <tr className="text-left text-xs text-warm-600 border-b">
        <th className="pb-2 font-medium">Name</th>
        <th className="pb-2 font-medium">Schedule</th>
        <th className="pb-2 font-medium">Last Run</th>
        <th className="pb-2 font-medium">Status</th>
        <th className="pb-2 font-medium"><VisuallyHidden>Actions</VisuallyHidden></th>
      </tr>
    </thead>
  );
}

function ScheduleTable({ schedules }: { schedules: ScheduleInfo[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <ScheduleTableHead />
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
      <Card as="section" aria-label="Schedules" shadow border="none">
        <h2 className="text-sm font-semibold text-warm-700 mb-2">Schedules</h2>
        <p className="text-sm text-warm-500 animate-pulse">Loading...</p>
      </Card>
    );
  }

  if (error) {
    return (
      <Card as="section" aria-label="Schedules" shadow border="none">
        <h2 className="text-sm font-semibold text-warm-700 mb-2">Schedules</h2>
        <p className="text-sm text-danger-dark">Failed to load: {error.message}</p>
      </Card>
    );
  }

  if (schedules.length === 0) {
    return (
      <Card as="section" aria-label="Schedules" shadow border="none">
        <h2 className="text-sm font-semibold text-warm-700 mb-2">Schedules</h2>
        <p className="text-sm text-warm-500">No scheduled scripts in config/schedules/</p>
      </Card>
    );
  }

  const skippedCount = recentTicks.filter(
    (t) => !t.result || (t.result.ran === 0 && t.result.errors === 0),
  ).length;

  return (
    <Card as="section" aria-label="Schedules" shadow border="none">
      <h2 className="text-sm font-semibold text-warm-700 mb-3">Schedules</h2>

      <ScheduleTable schedules={schedules} />

      {recentTicks.length > 0 ? (
        <div className="mt-3 pt-3 border-t">
          <InlineAction
            id="cb-dashboard-ticks-toggle"
            intent="subtle"
            onClick={() => setShowTicks(!showTicks)}
            className="text-xs"
          >
            {showTicks ? "Hide" : "Show"} recent ticks ({recentTicks.length})
            {skippedCount > 0 && !showTicks ? (
              <span className="ml-1 text-warm-500">
                &middot; {skippedCount} all-skipped
              </span>
            ) : null}
          </InlineAction>

          {showTicks ? (
            <div className="mt-2 space-y-1 text-xs">
              {recentTicks.map((tick, i) => (
                <TickEntry key={i} tick={tick} />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}
