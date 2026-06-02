/**
 * The live background-task strip: a row of pills above the composer showing
 * tasks the agent has running in the background (e.g. a backgrounded shell
 * command), each with a pulsing dot, its label, the last tool it touched, and
 * elapsed time. Pills appear when a task starts and disappear when it settles —
 * the settled result then shows as a permanent marker in the transcript.
 */

import { useState, useCallback } from "react";
import { applyTaskEvent, type LiveTask, type TaskEvent } from "./background-tasks";

/**
 * Hold the live-task list for one chat session. Returns the current tasks plus
 * the handler that folds in events arriving over SSE.
 */
export function useBackgroundTasks(): { tasks: LiveTask[]; onTaskEvent: (event: TaskEvent) => void } {
  const [tasks, setTasks] = useState<LiveTask[]>([]);
  const onTaskEvent = useCallback((event: TaskEvent) => {
    setTasks((prev) => applyTaskEvent(prev, event));
  }, []);
  return { tasks, onTaskEvent };
}

function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m${String(seconds).padStart(2, "0")}s`;
}

function TaskPill({ task }: { task: LiveTask }) {
  return (
    <div className="flex items-center gap-2 text-xs text-warm-600 bg-warm-50 border border-warm-200 rounded-full px-3 py-1">
      <span className="inline-block w-2 h-2 rounded-full bg-info animate-pulse flex-shrink-0" />
      <span className="font-medium truncate">{task.description}</span>
      {task.lastToolName ? (
        <span className="text-warm-400 flex-shrink-0">· {task.lastToolName}</span>
      ) : null}
      {task.elapsedMs !== undefined ? (
        <span className="text-warm-400 ml-auto flex-shrink-0 tabular-nums">{formatElapsed(task.elapsedMs)}</span>
      ) : null}
    </div>
  );
}

export function BackgroundTasks({ tasks }: { tasks: LiveTask[] }) {
  if (tasks.length === 0) return null;
  return (
    <div className="mx-3 sm:mx-6 mb-1 flex flex-col gap-1" aria-label="Background tasks">
      {tasks.map((task) => (
        <TaskPill key={task.taskId} task={task} />
      ))}
    </div>
  );
}
