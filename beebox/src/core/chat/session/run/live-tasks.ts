/**
 * The background tasks one chat run reports as live, and whether they still
 * look alive. The SDK's level signal says what is running but not that it is
 * making progress, so a hung task would otherwise hold its chat forever.
 */

import type { ChatBackendRun } from "../../../../services/claude-chat/core.js";
import type { LiveTaskEntry } from "../messages.js";
import { recordRunEnded } from "./ended-note.js";

/**
 * How long a run with live tasks may produce no message before the registry
 * treats it as hung. A running tool reports `tool_progress`, so only a stuck
 * task or a long silent background shell goes this quiet.
 */
export const BACKGROUND_STALL_MS = 4 * 60 * 60 * 1000;

export interface LiveTasks {
  /** Replace the set; the SDK's level signal is the whole set each time. */
  set(tasks: LiveTaskEntry[]): void;
  /** Record that the run produced a message, surfaced to consumers or not. */
  noteRunMessage(): void;
  count(): number;
  descriptions(): string[];
  isWorking(): boolean;
}

export function createLiveTasks(now: () => number): LiveTasks {
  let tasks: LiveTaskEntry[] = [];
  let lastRunMessageAt = now();
  return {
    set(next) { tasks = next; },
    noteRunMessage() { lastRunMessageAt = now(); },
    count: () => tasks.length,
    descriptions: () => tasks.map((task) => task.description),
    isWorking: () => tasks.length > 0 && now() - lastRunMessageAt < BACKGROUND_STALL_MS,
  };
}

/**
 * End a run on purpose. With tasks live the process ends outright: on closed
 * input they would keep working, their Bash calls would come back as a user's
 * refusal, and the parent would report that refusal. The CLI tells the next
 * turn they did not finish.
 */
export function endRun(run: ChatBackendRun, { tasks, sessionId, endedFor }: { tasks: LiveTasks; sessionId: string | null; endedFor?: { boxRoot: string; reason: string } }): void {
  if (tasks.count() === 0) { void run.close(); return; }
  console.warn(`[ChatSession] Ending run ${sessionId ?? "new"} with ${tasks.count()} live background task(s)${endedFor === undefined ? "" : ` for ${endedFor.reason}`}`);
  // Maintenance that cannot wait tells the next turn why (`./ended-note.ts`).
  if (endedFor !== undefined && sessionId !== null) recordRunEnded(endedFor.boxRoot, { sessionId, reason: endedFor.reason, tasks: tasks.descriptions(), now: new Date() });
  void run.abort();
}
