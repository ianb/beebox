/**
 * "Real user message" classification, split out of `session.ts` so the
 * bounded-retention scan (`session-retention.ts`) can use it without an import
 * cycle back through `session.ts`.
 */

import { stripChatAppTags } from "../../core/chat/features.js";
import type { SessionEntry } from "./session-entry.js";

/**
 * A "real" user message is one the human actually typed or spoke, as opposed
 * to system-injected user entries (tool results, schedule-fired notifications,
 * pending-schedules status, etc.). Real user messages carry a <typed> or
 * <speech> tag since the UI wraps human input in those — possibly preceded
 * by the <chat-app .../> snapshot tag the server prepends to every turn.
 */
export function isRealUserMessage(entry: SessionEntry): boolean {
  if (entry.type !== "user") return false;
  for (const block of entry.content) {
    if (block.type !== "text") continue;
    const text = stripChatAppTags((block.text || "").trimStart()).trimStart();
    if (text.startsWith("<typed") || text.startsWith("<speech")) return true;
  }
  return false;
}
