/**
 * Whether the server may close a box's chat runs for a live maintenance owner.
 * A turn in progress always waits. A run between turns with live background
 * tasks also waits, unless the owner cannot defer and its wait has run out
 * (`endsBackgroundTasksAt` on the phase record). A deferrable owner's drain
 * then times out and it defers (docs/implemented-plans/maintenance-live-tasks.md).
 */

import { pauseBoxChatSchedules, resumeBoxChatSchedules, boxChatScheduleDeliveriesAreIdle } from "../../core/chat/schedules/core.js";
import type { ChatSessionRegistry } from "../../core/chat/session/registry/core.js";
import { boxMaintenanceStatus } from "../../lib/box-maintenance/admission.js";
import { boxRequestsAreIdle } from "./box-admission.js";

export interface QuiesceSession { readonly busy: boolean; readonly liveTasks: number }

export type QuiesceDecision =
  | { quiesce: true }
  | { quiesce: false; waitingFor: "turn" | "background-tasks" };

export function decideChatQuiesce({ sessions, endsBackgroundTasksAt, now }: {
  sessions: readonly QuiesceSession[];
  endsBackgroundTasksAt: string | undefined;
  now: number;
}): QuiesceDecision {
  if (sessions.some((session) => session.busy)) return { quiesce: false, waitingFor: "turn" };
  const ending = endsBackgroundTasksAt !== undefined && now >= Date.parse(endsBackgroundTasksAt);
  if (!ending && sessions.some((session) => session.liveTasks > 0)) return { quiesce: false, waitingFor: "background-tasks" };
  return { quiesce: true };
}

/**
 * One box's step of the server's one-second maintenance poll: pause chat
 * schedules while a live owner holds the box, close idle runs when
 * `decideChatQuiesce` allows, and resume when the owner is gone. Logs one line
 * per maintenance attempt and outcome, so an incident names its owner.
 */
export function createMaintenanceChatCheck(): (boxRoot: string, registry: Pick<ChatSessionRegistry, "snapshotAll" | "quiesceForMaintenance" | "resumeAfterMaintenance">) => Promise<void> {
  const paused = new Set<string>();
  const noted = new Set<string>();
  const noteOnce = (key: string, line: string): void => {
    if (noted.has(key)) return;
    if (noted.size >= 64) noted.clear();
    noted.add(key);
    console.log(line);
  };
  return async (boxRoot, registry) => {
    // Only a live owner pauses chat; a record without one is unfinished maintenance, not closure.
    const status = await boxMaintenanceStatus(boxRoot);
    if (!status?.owner) {
      if (paused.delete(boxRoot)) {
        registry.resumeAfterMaintenance();
        resumeBoxChatSchedules(boxRoot);
      }
      return;
    }
    pauseBoxChatSchedules(boxRoot);
    paused.add(boxRoot);
    const sessions = registry.snapshotAll();
    const decision = decideChatQuiesce({ sessions, endsBackgroundTasksAt: status.endsBackgroundTasksAt, now: Date.now() });
    const owner = `${status.reason} (pid ${String(status.owner.pid)}, since ${status.owner.since})`;
    if (!decision.quiesce && decision.waitingFor === "background-tasks") {
      const working = sessions.filter((session) => session.liveTasks > 0).length;
      noteOnce(`${status.id}:wait`, `[maintenance] ${owner} waits for ${String(working)} chat(s) with live background tasks`);
    } else if (decision.quiesce && boxRequestsAreIdle(boxRoot) && boxChatScheduleDeliveriesAreIdle(boxRoot)) {
      noteOnce(`${status.id}:quiesce`, `[maintenance] Closing idle chat runs for ${owner}`);
      registry.quiesceForMaintenance(status.reason);
    }
  };
}
