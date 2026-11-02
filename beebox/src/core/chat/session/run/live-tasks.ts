/**
 * The background tasks one chat run reports as live, and whether they still
 * look alive. The SDK's level signal says what is running but not that it is
 * making progress, so a hung task would otherwise hold its chat forever.
 */

import type { ChatBackendRun } from "../../../../services/claude-chat/core.js";
import type { LiveTaskEntry } from "../messages.js";
import { createTaskRecorder } from "./ended-note.js";

/**
 * How long a run with live tasks may produce no message before the registry
 * treats it as hung. A running tool reports `tool_progress`, so only a stuck
 * task or a long silent background shell goes this quiet.
 */
export const BACKGROUND_STALL_MS = 4 * 60 * 60 * 1000;

export interface LiveTasks {
  /** Reset in memory at a run's start: the CLI's set is per process, and a new run has no recorded end. */
  set(tasks: LiveTaskEntry[]): void;
  /** The SDK's level signal (the whole set each time): replace the set and keep the task record current. */
  observe(tasks: LiveTaskEntry[]): void;
  /** Record that the run produced a message, surfaced to consumers or not. */
  noteRunMessage(): void;
  /** The server is ending this run on purpose; `cause` (agent-facing) is what the next turn hears. */
  recordEnd(cause: string | undefined): void;
  /** The run closed. With tasks live and no end recorded, it ended on its own. */
  closed(): void;
  count(): number;
  isWorking(): boolean;
}

/** With `record`, the set is kept on disk for the next turn's run-ended note (`./ended-note.ts`). */
export function createLiveTasks(now: () => number, record?: { boxRoot: string; sessionId: () => string | null }): LiveTasks {
  const recorder = record === undefined ? undefined : createTaskRecorder(record.boxRoot, record.sessionId);
  let tasks: LiveTaskEntry[] = [];
  let lastRunMessageAt = now();
  let endRecorded = false;
  const descriptions = (): string[] => tasks.map((task) => task.description);
  return {
    set(next) { tasks = next; endRecorded = false; },
    observe(next) { tasks = next; recorder?.observe(descriptions(), new Date(now())); },
    noteRunMessage() { lastRunMessageAt = now(); recorder?.heartbeat(descriptions(), new Date(now())); },
    recordEnd(cause) {
      endRecorded = true;
      if (cause !== undefined && tasks.length > 0) recorder?.ended({ tasks: descriptions(), cause, now: new Date(now()) });
    },
    closed() {
      if (!endRecorded && tasks.length > 0) recorder?.ended({ tasks: descriptions(), cause: "the agent process ended on its own", now: new Date(now()) });
      tasks = [];
    },
    count: () => tasks.length,
    isWorking: () => tasks.length > 0 && now() - lastRunMessageAt < BACKGROUND_STALL_MS,
  };
}

/**
 * End a run on purpose. With tasks live the process ends outright: on closed
 * input they would keep working, their Bash calls would come back as a user's
 * refusal, and the parent would report that refusal. The CLI tells the next
 * turn they did not finish; `cause` tells it why (`./ended-note.ts`).
 */
export function endRun(run: ChatBackendRun, { tasks, sessionId, cause }: { tasks: LiveTasks; sessionId: string | null; cause?: string | undefined }): void {
  tasks.recordEnd(cause);
  if (tasks.count() === 0) { void run.close(); return; }
  console.warn(`[ChatSession] Ending run ${sessionId ?? "new"} with ${tasks.count()} live background task(s)${cause === undefined ? "" : `: ${cause}`}`);
  void run.abort();
}
