/**
 * Live background-task state: the pure reducer and types behind the in-flight
 * task strip. Background tasks (e.g. a backgrounded shell command) report a
 * lifecycle over the event bus — `started`, `progress`, `updated`, `settled` —
 * and this folds that stream into the small list of tasks currently running.
 *
 * Terminal tasks drop out of the live list: their settled
 * `<task-notification>` already lands in the transcript as a permanent marker,
 * so keeping them here too would double them up.
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

const TERMINAL_STATUSES = new Set(["completed", "failed", "stopped", "killed"]);

/**
 * Fold one task event into the live list. `started` registers a task;
 * `progress`/`updated` merge into an existing one (ignored if we never saw it
 * start — e.g. ambient `skip_transcript` tasks); `settled` (or any terminal
 * status) removes it.
 */
export function applyTaskEvent(tasks: LiveTask[], event: TaskEvent): LiveTask[] {
  if (event.phase === "settled" || (event.status !== undefined && TERMINAL_STATUSES.has(event.status))) {
    return tasks.filter((t) => t.taskId !== event.taskId);
  }

  const existing = tasks.find((t) => t.taskId === event.taskId);
  if (existing === undefined && event.phase !== "started") {
    // Progress/updated for a task we never registered — skip it.
    return tasks;
  }

  const merged: LiveTask = {
    taskId: event.taskId,
    description: event.description ?? existing?.description ?? "Background task",
    status: event.status ?? existing?.status ?? "running",
  };
  const summary = event.summary ?? existing?.summary;
  if (summary !== undefined) merged.summary = summary;
  const lastToolName = event.lastToolName ?? existing?.lastToolName;
  if (lastToolName !== undefined) merged.lastToolName = lastToolName;
  const elapsedMs = event.elapsedMs ?? existing?.elapsedMs;
  if (elapsedMs !== undefined) merged.elapsedMs = elapsedMs;

  if (existing !== undefined) {
    return tasks.map((t) => (t.taskId === event.taskId ? merged : t));
  }
  return [...tasks, merged];
}
