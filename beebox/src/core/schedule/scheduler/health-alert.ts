/**
 * Scheduled-task health episodes, run by the scheduler daemon after each box's
 * tick (`box-alerts.ts`).
 *
 * A task that is newly failing, overdue, or invalid is a health entry: the
 * `scheduled-tasks` check in the dashboard's health snapshot
 * (`webapp/trpc/routers/health-schedules.ts`). It never notifies on its own
 * (docs/implemented-plans/notifications.md, Track E); a boxholder-requested schedule that
 * cannot run is promoted separately (`promotion.ts`).
 *
 * This module keeps the once-per-episode latch so the scheduler log records an
 * episode once: it stamps each newly unhealthy task (alertedAt/alertedFor), and
 * a successful run clears the stamp (`recordOutcome`), so a relapse is a new
 * episode.
 */

import { loadScheduleHealth, selectAlertableTasks } from "../health-box.js";
import type { TaskHealth } from "../health.js";
import { loadScriptState, saveScriptState } from "../state.js";

export interface HealthEpisodeResult {
  /** Names of the tasks whose unhealthy episode began since the last pass. */
  tasks: string[];
}

function latchKind(task: TaskHealth): "failing" | "overdue" | "invalid" {
  if (task.status === "overdue") return "overdue";
  if (task.status === "invalid") return "invalid";
  return "failing";
}

/**
 * Stamp every task whose unhealthy episode is new. Returns null when there is
 * no new episode.
 */
export async function recordScheduleEpisodes(boxRoot: string, { now }: { now: Date }): Promise<HealthEpisodeResult | null> {
  const health = await loadScheduleHealth(boxRoot, now);
  const fresh = selectAlertableTasks(health).filter((t) => t.alertedAt === null);
  if (fresh.length === 0) return null;
  for (const task of fresh) {
    const state = await loadScriptState(boxRoot, task.name);
    state.alertedAt = now.toISOString();
    state.alertedFor = latchKind(task);
    await saveScriptState({ boxRoot, scriptName: task.name, state });
  }
  return { tasks: fresh.map((t) => t.name) };
}
