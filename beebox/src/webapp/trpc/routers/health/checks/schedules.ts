/**
 * Scheduled-task and engine-quota health checks: the dashboard entries that
 * replaced the scheduler's proactive alerts (docs/implemented-plans/notifications.md,
 * Track E). Health never notifies on its own; these checks are where the
 * boxholder sees a task that keeps failing, is overdue, or cannot parse, and
 * an engine out of usage quota.
 */

import { formatRetryAt } from "../../../../../core/agent/engine-unavailability.js";
import {
  describeParkedUpdates,
  describeUnhealthyTask,
  formatDurationShort,
  selectAlertableTasks,
  type BoxScheduleHealth,
} from "../../../../../core/schedule/health-box.js";
import { conciseScheduleError, type TaskHealth } from "../../../../../core/schedule/health.js";
import type { StoredEngineUnavailability } from "../../../../../core/agent/engine-availability-store.js";
import type { HealthCheck } from "../router.js";

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
 * daemon (a dev box) nothing is expected to run. A stale daemon (it ran here
 * and stopped) is a warning whatever the tasks say, naming its last heartbeat;
 * its overdue tasks fold into that finding. With no heartbeat ever, a healthy
 * check says the scheduler has never run rather than that tasks are running.
 */
export function scheduledTasksCheck(health: BoxScheduleHealth, now: Date): HealthCheck {
  const unhealthy = selectAlertableTasks(health).filter((t) => t.status !== "overdue" || health.scheduler.status === "running");
  const { scheduler } = health;
  if (scheduler.status === "stale") {
    const age = scheduler.ageMs === null ? "" : ` (${formatDurationShort(scheduler.ageMs)} ago)`;
    const tasks = unhealthy.length === 0 ? "" : `; ${unhealthy.map((t) => taskLine(t, now)).join("; ")}`;
    return {
      name: "scheduled-tasks",
      ok: false,
      message: `The scheduler is not running: last heartbeat ${scheduler.lastTickAt ?? "unknown"}${age}${tasks}`,
      severity: "warning",
    };
  }
  if (unhealthy.length === 0) {
    // No heartbeat ever (a dev box): true and fine, but not "running".
    const message = scheduler.status === "never" ? "The scheduler has never run on this box" : "Scheduled tasks are running";
    return { name: "scheduled-tasks", ok: true, message, severity: "warning" };
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
