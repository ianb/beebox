/**
 * Scheduled-task and engine-quota health checks: the dashboard entries that
 * replaced the scheduler's proactive alerts (docs/plans/notifications.md,
 * Track E). Health never notifies on its own; these checks are where the
 * boxholder sees a task that keeps failing, is overdue, or cannot parse, and
 * an engine out of usage quota.
 */

import { formatRetryAt } from "../../../core/agent/engine-unavailability.js";
import {
  describeParkedUpdates,
  describeUnhealthyTask,
  formatDurationShort,
  selectAlertableTasks,
  type BoxScheduleHealth,
} from "../../../core/schedule/health-box.js";
import { conciseScheduleError, type TaskHealth } from "../../../core/schedule/health.js";
import type { StoredEngineUnavailability } from "../../../core/agent/engine-availability-store.js";
import type { HealthCheck } from "./health.js";

function taskLine(task: TaskHealth, now: Date): string {
  let line = describeUnhealthyTask(task, now);
  if (task.status === "failing" && task.lastError) line = `${line} — ${conciseScheduleError(task.lastError)}`;
  // Last, after the error: the reader sees the symptom, then that the fix is
  // already parked on disk and only needs accepting.
  const parked = describeParkedUpdates(task);
  return parked === null ? line : `${line} — ${parked}`;
}

/**
 * `scheduled-tasks`: tasks failing twice in a row, invalid, or overdue. An
 * overdue task counts only while the scheduler daemon is running: with no
 * daemon (a dev box) nothing is expected to run, and a stale daemon is its own
 * finding.
 */
export function scheduledTasksCheck(health: BoxScheduleHealth, now: Date): HealthCheck {
  const unhealthy = selectAlertableTasks(health).filter((t) => t.status !== "overdue" || health.scheduler.status === "running");
  if (unhealthy.length === 0) {
    return { name: "scheduled-tasks", ok: true, message: "Scheduled tasks are running", severity: "warning" };
  }
  return {
    name: "scheduled-tasks",
    ok: false,
    message: `Scheduled tasks need attention: ${unhealthy.map((t) => taskLine(t, now)).join("; ")}`,
    severity: "warning",
  };
}

/** `engine-quota`: the box's engine is out of usage quota; scheduled work waits. None when it is available. */
export function engineQuotaChecks(live: StoredEngineUnavailability | null, now: Date): HealthCheck[] {
  if (live === null) return [];
  const since = formatDurationShort(now.getTime() - new Date(live.episodeStartedAt).getTime());
  return [{
    name: "engine-quota",
    ok: false,
    message: `The ${live.provider} engine is out of usage quota until ${formatRetryAt(live.retryAt)} (for ${since} so far). Scheduled work waits until then; chat on this engine fails.`,
    severity: "warning",
  }];
}
