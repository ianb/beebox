/**
 * Live background-task state: the pure reducers and types behind the in-flight
 * task strip. Membership comes only from the CLI's level signal
 * (`background_tasks_changed`, forwarded as `chat-task-level`): each payload
 * replaces the set, so a missed `settled` bookend cannot leave a pill running.
 * The `started` / `progress` / `updated` / `settled` edge stream only adds
 * detail (last tool, elapsed time, summary) to a task already in the set. The
 * SDK leaves the order of the two streams unspecified, so they are never
 * paired.
 *
 * A finished task's settled `<task-notification>` lands in the transcript as
 * a permanent marker.
 */

/** Wire shape of a background-task event, mirroring the backend `TaskEvent`. */
export interface TaskEvent {
  phase: "started" | "progress" | "updated" | "settled";
  taskId: string;
  description?: string;
  summary?: string;
  status?: "pending" | "running" | "completed" | "failed" | "stopped" | "killed" | "paused";
  elapsedMs?: number;
  lastToolName?: string;
}

/** A task currently in flight, as rendered in the live strip. */
export interface LiveTask {
  taskId: string;
  description: string;
  status: "pending" | "running" | "completed" | "failed" | "stopped" | "killed" | "paused";
  summary?: string;
  lastToolName?: string;
  elapsedMs?: number;
}

/** One entry of the level signal, mirroring the backend `LiveTaskEntry`. */
export interface LiveTaskEntry {
  taskId: string;
  description: string;
}

/**
 * Replace the live set with a level payload. Detail already gathered from
 * edge events is kept for tasks that remain; tasks absent from the payload
 * drop out.
 */
export function applyTaskLevel(tasks: LiveTask[], level: LiveTaskEntry[]): LiveTask[] {
  return level.map((entry) => {
    const existing = tasks.find((t) => t.taskId === entry.taskId);
    if (existing === undefined) return { taskId: entry.taskId, description: entry.description, status: "running" };
    return { ...existing, description: entry.description };
  });
}

/**
 * Merge one edge event's detail into a task already in the live set. Edge
 * events never add or remove tasks (see the module comment), so an event for
 * a task outside the set is a no-op.
 */
export function applyTaskEvent(tasks: LiveTask[], event: TaskEvent): LiveTask[] {
  const existing = tasks.find((t) => t.taskId === event.taskId);
  if (existing === undefined) return tasks;

  const merged: LiveTask = {
    taskId: event.taskId,
    description: event.description ?? existing.description,
    status: event.status ?? existing.status,
  };
  const summary = event.summary ?? existing.summary;
  if (summary !== undefined) merged.summary = summary;
  const lastToolName = event.lastToolName ?? existing.lastToolName;
  if (lastToolName !== undefined) merged.lastToolName = lastToolName;
  const elapsedMs = event.elapsedMs ?? existing.elapsedMs;
  if (elapsedMs !== undefined) merged.elapsedMs = elapsedMs;
  return tasks.map((t) => (t.taskId === event.taskId ? merged : t));
}
