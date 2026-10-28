/**
 * Accepted chat messages the agent never received, and the ones the person
 * then removed.
 *
 * `ChatSession.stop()` drops whatever is still queued; the route layer records
 * each dropped message the client can name as `chat-user-message-undelivered`
 * (`webapp/routes/chat/register.ts`). A person who removes one records
 * `chat-user-message-discarded`. Neither deletes the accepted row: the bus
 * keeps all three, and `readAcceptedMessages` reads them together
 * (`docs/implemented-plans/chat-not-delivered.md`).
 *
 * Markers are keyed by message id, which the client coins once per send.
 */

import type { EventBus } from "../../event-bus/core.js";

/**
 * How many recent markers of each kind to consider. Matches the accepted-row
 * scan (`ACCEPTED_SCAN_LIMIT` in `accepted-messages.ts`): each marked message
 * has at most one marker of each kind, so a message still inside that scan has
 * its markers inside this one.
 */
const MARKER_SCAN_LIMIT = 50;

/** The undelivered markers' sessions by message id, and the discarded message ids. */
export interface DropMarks {
  undelivered: Map<string, string | null>;
  discarded: Set<string>;
}

export function readDropMarks(eventBus: EventBus): DropMarks {
  const undelivered = new Map<string, string | null>();
  for (const event of eventBus.readRecent({ event: "chat-user-message-undelivered", limit: MARKER_SCAN_LIMIT })) {
    if (event.event === "unknown") continue;
    undelivered.set(event.data.messageId, event.data.sessionId);
  }
  const discarded = new Set<string>();
  for (const event of eventBus.readRecent({ event: "chat-user-message-discarded", limit: MARKER_SCAN_LIMIT })) {
    if (event.event === "unknown") continue;
    discarded.add(event.data.messageId);
  }
  return { undelivered, discarded };
}

/**
 * Record that the person removed an undelivered message. Fails closed: with no
 * undelivered marker for this message in this session, nothing is recorded and
 * the answer is `"not-found"`, so a discard cannot hide a delivered message. A
 * marker with no session (dropped before the engine assigned an id) matches any
 * session, since the page asking has since learned the id. A second discard of
 * the same message records nothing more.
 */
export function discardUndelivered(
  eventBus: EventBus,
  { sessionId, messageId, now }: { sessionId: string | null; messageId: string; now: Date },
): "discarded" | "not-found" {
  const marks = readDropMarks(eventBus);
  const markedSession = marks.undelivered.get(messageId);
  if (markedSession === undefined) return "not-found";
  if (markedSession !== null && markedSession !== sessionId) return "not-found";
  if (marks.discarded.has(messageId)) return "discarded";
  eventBus.emit("chat-user-message-discarded", { sessionId, messageId, timestamp: now.toISOString() });
  return "discarded";
}
