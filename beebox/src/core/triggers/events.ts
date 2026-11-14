/**
 * The `trigger-changed` event from a process that has no long-lived bus (the
 * CLI): open the box's bus, emit, close. The server's runner hears it over
 * the bus's poll and reloads the session's timers; the status line refetches.
 */

import { createEventBus } from "../event-bus/core.js";

/** Returns false when the bus refused the event; the activation is written either way. */
export function emitTriggerChanged(boxRoot: string, sessionId: string): boolean {
  try {
    const bus = createEventBus(boxRoot);
    try {
      bus.emit("trigger-changed", { sessionId });
    } finally {
      bus.close();
    }
    return true;
  } catch (e) {
    console.warn(`[triggers] could not emit trigger-changed for ${sessionId}:`, e);
    return false;
  }
}
