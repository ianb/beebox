/**
 * A trigger notice is delivered in the user slot (the chat has no other
 * slot for a message nobody typed), but it is not the person speaking: it
 * renders as a system row, like a compaction marker, not as a user bubble.
 * An entry whose only content is `<trigger>` blocks is such a row; one that
 * mixes a trigger with typed text keeps the bubble and shows a chip inside.
 */

import { parseDeliveredUserMessageParts } from "@shared/delivered-user-message";
import type { TriggerUserMessage } from "@shared/delivered-trigger-message";

/** The entry's trigger notices when that is all it holds; null otherwise. */
export function entryTriggerNotices(entry: { type: string; content: { type: string; text?: string | undefined }[] }): TriggerUserMessage[] | null {
  if (entry.type !== "user") return null;
  const text = entry.content.filter((b) => b.type === "text").map((b) => b.text ?? "").join("\n");
  if (!/<trigger\b/i.test(text)) return null;
  const parts = parseDeliveredUserMessageParts(text);
  const notices = parts.filter((p): p is TriggerUserMessage => p.kind === "trigger");
  if (notices.length === 0) return null;
  const other = parts.some((p) => p.kind !== "trigger" && (p.kind !== "text" || p.text.trim() !== ""));
  return other ? null : notices;
}

/** The link text for the notice's card: the file name without its type suffix, underscores as spaces. */
export function cardTitleOf(card: string): string {
  const base = card.split("/").at(-1) ?? card;
  return base.replace(/\.[a-z-]+\.card$/i, "").replace(/_/g, " ");
}
