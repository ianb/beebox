/**
 * The box's trigger runner (docs/plans/activity-triggers.md, Track C): one
 * per box, fed by the activity route, delivering fires through the same path
 * as captures and calls. The CLI arms and disarms from another process; its
 * `trigger-changed` arrives over the bus's poll and reloads the session's
 * timers.
 */

import type { ChatSessionRegistry } from "../../../core/chat/session/registry/core.js";
import type { ChatSession } from "../../../core/chat/session/run/core.js";
import { deliverUserMessage } from "../../../core/chat/session/deliver-user-message.js";
import { getDirectoryForSession } from "../../../core/chat/session/history.js";
import type { EventBus } from "../../../core/event-bus/core.js";
import { clearTriggerRunner, setTriggerRunner, TriggerRunner } from "../../../core/triggers/runner/core.js";

/** Start the runner and register it for the box; returns the stop for the server's `onClose`. */
export function startTriggerRunner(args: {
  boxRoot: string;
  eventBus: EventBus;
  registry: ChatSessionRegistry;
  wireSession: (session: ChatSession) => void;
}): () => void {
  const { boxRoot, eventBus, registry, wireSession } = args;
  const runner = new TriggerRunner({
    boxRoot,
    deliver: async ({ sessionId, message, onAdmitted }) => {
      const target = { sessionId, contextDir: await getDirectoryForSession(boxRoot, sessionId) };
      // A fire runs from the runner's timers, not from a request: it needs its own box-work permit.
      await deliverUserMessage({ boxRoot, registry, eventBus, wireSession, target, message, logPrefix: "trigger", onAdmitted, independent: true });
    },
    emit: (sessionId) => { eventBus.emit("trigger-changed", { sessionId }); },
  });
  setTriggerRunner(boxRoot, runner);
  void runner.boot().catch((e: unknown) => { console.error("[triggers] boot scan failed:", e); });
  const changes = eventBus.subscribe({
    listener: (event) => {
      if (event.event !== "trigger-changed") return;
      void runner.reload(event.data.sessionId).catch((e: unknown) => { console.warn("[triggers] reload failed:", e); });
    },
  });
  return () => {
    changes.unsubscribe();
    runner.stop();
    clearTriggerRunner(boxRoot);
  };
}
