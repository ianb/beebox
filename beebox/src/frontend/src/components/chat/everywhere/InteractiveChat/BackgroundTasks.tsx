/**
 * The live background-task strip: a row of pills above the composer showing
 * tasks the agent has running in the background (e.g. a backgrounded shell
 * command), each with a pulsing dot, its label, the last tool it touched, and
 * elapsed time. Pills follow the CLI's live background-task set; a finished
 * task's result then shows as a permanent marker in the transcript.
 */

import { useState, useCallback } from "react";
import { formatDuration } from "@shared/relative-time";
import { applyTaskEvent, applyTaskLevel, type LiveTask, type LiveTaskEntry, type TaskEvent } from "./background-tasks";

/**
 * Hold the live-task list for one chat session. Returns the current tasks plus
 * the handlers that fold in the level signal (membership) and edge events
 * (detail) arriving over the event bus.
 */
export function useBackgroundTasks(): {
  tasks: LiveTask[];
  onTaskEvent: (event: TaskEvent) => void;
  onTaskLevel: (level: LiveTaskEntry[]) => void;
} {
  const [tasks, setTasks] = useState<LiveTask[]>([]);
  const onTaskEvent = useCallback((event: TaskEvent) => {
    setTasks((prev) => applyTaskEvent(prev, event));
  }, []);
  const onTaskLevel = useCallback((level: LiveTaskEntry[]) => {
    setTasks((prev) => applyTaskLevel(prev, level));
  }, []);
  return { tasks, onTaskEvent, onTaskLevel };
}

function TaskPill({ task }: { task: LiveTask }) {
  return (
    <div className="flex items-center gap-2 text-xs text-warm-700 bg-warm-50 border border-warm-200 rounded-full px-3 py-1">
      <span className="inline-block w-2 h-2 rounded-full bg-info animate-pulse flex-shrink-0" />
      <span className="font-medium truncate">{task.description}</span>
      {task.lastToolName ? (
        <span className="text-warm-400 flex-shrink-0">· {task.lastToolName}</span>
      ) : null}
      {task.elapsedMs !== undefined ? (
        <span className="text-warm-400 ml-auto flex-shrink-0 tabular-nums">{formatDuration(task.elapsedMs)}</span>
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
