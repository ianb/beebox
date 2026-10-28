/**
 * Schedule overview — table of all scheduled scripts with status and recent ticks.
 */

import { useState } from "react";
import { useBoxNow } from "../../../lib/box-clock";
import { useNow } from "../../../lib/use-now";
import { trpc } from "../../../lib/trpc/client";
import type { RouterOutput } from "../../../lib/trpc/client";
import { bbxSource } from "../../../lib/source-tag";
import { Button } from "../../ui/Button";
import { Card } from "../../ui/Card";
import { InlineAction } from "../../ui/InlineAction";
import { Toggle } from "../../ui/Toggle";
import { VisuallyHidden } from "../../ui/VisuallyHidden";
import { ScheduleStatusIndicator } from "./ScheduleStatusIndicator";
import { RunHistory } from "./RunHistory";
import { RunStrip } from "./RunStrip";
import { Badge } from "../../ui/Badge";
import { TickList, quietTickCount } from "../ScheduleTicks";
import { agoOnClock } from "../../../lib/relative-time";
import { formatDuration } from "@shared/relative-time";

type ScheduleInfo = RouterOutput["scheduler"]["schedules"]["schedules"][number];
type SchedulerLogEntry = RouterOutput["scheduler"]["log"]["entries"][number];

interface ScheduleOverviewProps {
  schedules: ScheduleInfo[];
  recentTicks: SchedulerLogEntry[];
  loading?: boolean;
  error?: { message: string } | null;
}

function BudgetIndicator({ budget }: { budget: { limitMs: number; windowMs: number; usedMs: number } }) {
  const exceeded = budget.usedMs >= budget.limitMs;
  const cls = exceeded ? "text-danger-dark font-medium" : "text-warm-700";
  return (
    <span className={`ml-1 ${cls}`} title={`${formatDuration(budget.usedMs)} used of ${formatDuration(budget.limitMs)} budget in ${formatDuration(budget.windowMs)} window`}>
      [{formatDuration(budget.usedMs)}/{formatDuration(budget.limitMs)}]
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
      label={`Schedule ${name}`}
      className="shrink-0"
    />
  );
}

/** Run the schedule now; when it finishes, `onFinished` opens its run history to show the result. */
function TriggerButton({ name, enabled, onFinished }: { name: string; enabled: boolean; onFinished: () => void }) {
  const utils = trpc.useUtils();
  const finished = () => {
    void utils.scheduler.schedules.invalidate();
    void utils.scheduler.runs.invalidate({ name });
    onFinished();
  };
  const mutation = trpc.scheduler.trigger.useMutation({ onSuccess: finished, onError: finished });

  return (
    <Button
      intent="secondary"
      size="sm"
      onClick={() => mutation.mutate({ name })}
      disabled={!enabled}
      loading={mutation.isPending}
      loadingLabel="..."
      label={`Run ${name}`}
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
          <span className="block text-xs text-warm-700">{s.description}</span>
        ) : null}
        {s.lastSummary === null ? null : s.lastSummary.priority === "attention" ? (
          <span className="block text-xs text-warm-800">
            <Badge tone="warning" size="sm" className="mr-1">attention</Badge>
            {s.lastSummary.headline}
          </span>
        ) : (
          <Badge tone="neutral" size="sm" title="The last run's priority; open its runs for the summary">normal</Badge>
        )}
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
  const [showRuns, setShowRuns] = useState(false);
  // Re-render each minute so the "last run" age stays current.
  useBoxNow(60_000);

  return (
    <>
      <tr className={!s.enabled ? "opacity-50" : ""} {...bbxSource("schedule", s.name)}>
        <td className="py-2 pr-3">
          <ScheduleNameCell s={s} />
        </td>
        <td className="py-2 pr-3 text-warm-700 text-xs">
          <span title={rawScheduleTitle(s)}>{s.cadence}</span>
          {s.budget ? <BudgetIndicator budget={s.budget} /> : null}
        </td>
        <td className="py-2 pr-3 text-warm-700 text-xs">
          {s.lastRun ? (
            <InlineAction
              intent="subtle"
              onClick={() => setShowRuns(!showRuns)}
              expanded={showRuns}
              title={showRuns ? "Hide recent runs" : "Show recent runs"}
              className="text-xs whitespace-nowrap"
            >
              {agoOnClock(s.lastRun, "box")} {showRuns ? "\u25BE" : "\u25B8"}
            </InlineAction>
          ) : "never"}
          <RunStrip runs={s.runStrip} />
        </td>
        <td className="py-2 pr-3">
          {s.missingRequirements && s.missingRequirements.length > 0 ? (
            <span className="text-warning text-xs" title={`Missing: ${s.missingRequirements.join(", ")}`}>
              &#9888; {s.missingRequirements.join(", ")}
            </span>
          ) : s.running ? (
            <RunningIndicator running={s.running} />
          ) : (
            <ScheduleStatusIndicator lastResult={s.lastResult} lastError={s.lastError} lastDeferReason={s.lastDeferReason} onShowRuns={() => setShowRuns(!showRuns)} />
          )}
        </td>
        <td className="py-2">
          <TriggerButton name={s.name} enabled={s.enabled} onFinished={() => setShowRuns(true)} />
        </td>
      </tr>
      {showRuns ? (
        <tr>
          <td colSpan={5} className="pb-2">
            <RunHistory name={s.name} />
          </td>
        </tr>
      ) : null}
    </>
  );
}

function ScheduleTableHead() {
  return (
    <thead>
      <tr className="text-left text-xs text-warm-700 border-b">
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
  const now = useNow(5000);
  const startedAt = Date.parse(running.startedAt);
  const elapsed = now === 0 || Number.isNaN(startedAt) ? null : formatDuration(Math.max(0, now - startedAt));
  return (
    <span className="text-warning text-xs font-medium" title={`Triggered by ${running.triggeredBy}`}>
      <span className="inline-block w-2 h-2 rounded-full bg-warning animate-pulse mr-1 align-middle" />
      running{elapsed === null ? "" : ` (${elapsed})`}
    </span>
  );
}

export function ScheduleOverview({ schedules, recentTicks, loading, error }: ScheduleOverviewProps) {
  const [showTicks, setShowTicks] = useState(false);

  if (loading) {
    return (
      <Card as="section" aria-label="Schedules" shadow border="none">
        <h2 className="text-sm font-semibold text-warm-700 mb-2">Schedules</h2>
        <p className="text-sm text-warm-700 animate-pulse">Loading...</p>
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
        <p className="text-sm text-warm-700">No scheduled scripts in _config/schedules/</p>
      </Card>
    );
  }

  const skippedCount = quietTickCount(recentTicks);

  return (
    <Card as="section" aria-label="Schedules" shadow border="none">
      <h2 className="text-sm font-semibold text-warm-700 mb-3">Schedules</h2>

      <ScheduleTable schedules={schedules} />

      {recentTicks.length > 0 ? (
        <div className="mt-3 pt-3 border-t">
          <InlineAction
            id="bbx-dashboard-ticks-toggle"
            intent="subtle"
            onClick={() => setShowTicks(!showTicks)}
            className="text-xs"
          >
            {showTicks ? "Hide" : "Show"} recent ticks ({recentTicks.length})
            {skippedCount > 0 && !showTicks ? (
              <span className="ml-1 text-warm-700">
                &middot; {skippedCount} all-skipped
              </span>
            ) : null}
          </InlineAction>

          {showTicks ? <TickList ticks={recentTicks} /> : null}
        </div>
      ) : null}
    </Card>
  );
}
