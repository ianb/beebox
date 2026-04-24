/**
 * Pure helpers shared by chatMachine (regular chat) and activityChatMachine
 * (per-activity chat). Kept free of tRPC / SSE / API concerns so both
 * machines can drop them in unchanged.
 */

import type {
  SessionEntry,
  SessionContentBlock,
  ChatImageAttachment,
} from "../api";

/**
 * Build content blocks for the optimistic user message bubble displayed
 * before the server responds. Mirrors the server-side `buildContentBlocks`
 * in chat-session.ts so the local preview matches what gets stored in the
 * session log — `[imageN]` tokens become inline image blocks.
 */
export function buildOptimisticContent(
  message: string,
  images?: ChatImageAttachment[],
): SessionContentBlock[] {
  const attached = images === undefined ? [] : images;
  if (attached.length === 0) {
    return [{ type: "text", text: message }];
  }

  const byId = new Map<number, ChatImageAttachment>();
  for (const img of attached) byId.set(img.id, img);
  const used = new Set<number>();

  const blocks: SessionContentBlock[] = [];
  const tokenRe = /\[image(\d+)]/g;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = tokenRe.exec(message)) !== null) {
    const idStr = match[1];
    if (idStr === undefined) continue;
    const id = parseInt(idStr, 10);
    const img = byId.get(id);
    if (img === undefined) continue;
    if (match.index > cursor) {
      blocks.push({ type: "text", text: message.slice(cursor, match.index) });
    }
    blocks.push({
      type: "image",
      mediaType: img.mimeType,
      dataBase64: img.dataBase64,
    });
    used.add(id);
    cursor = match.index + match[0].length;
  }
  if (cursor < message.length) {
    blocks.push({ type: "text", text: message.slice(cursor) });
  }
  for (const img of attached) {
    if (used.has(img.id)) continue;
    blocks.push({
      type: "image",
      mediaType: img.mimeType,
      dataBase64: img.dataBase64,
    });
  }
  return blocks;
}

/** Extract the text content from a session entry. */
export function entryText(entry: SessionEntry): string {
  return entry.content
    .filter((b): b is { type: "text"; text: string } => b.type === "text")
    .map((b) => b.text)
    .join("");
}

/**
 * After fetching server history, filter out pending messages that the server
 * has caught up to, then append remaining pending messages so they stay visible.
 *
 * The backend's drainQueue() combines multiple queued messages into one turn
 * (joined with \n\n), so we use substring matching: a pending message is
 * considered delivered if its text appears as a substring of any recent
 * server user message.
 */
export function reconcilePending(params: {
  serverMessages: SessionEntry[];
  pendingMessages: SessionEntry[];
}): { messages: SessionEntry[]; pendingMessages: SessionEntry[] } {
  const { serverMessages, pendingMessages } = params;
  if (pendingMessages.length === 0) {
    return { messages: serverMessages, pendingMessages: [] };
  }

  const serverUserTexts: string[] = [];
  for (
    let i = serverMessages.length - 1;
    i >= 0 && serverUserTexts.length < pendingMessages.length + 5;
    i--
  ) {
    const entry = serverMessages[i];
    if (entry && entry.type === "user") {
      serverUserTexts.push(entryText(entry));
    }
  }

  const stillPending = pendingMessages.filter((pm) => {
    const pmText = entryText(pm);
    return !serverUserTexts.some((st) => st === pmText || st.includes(pmText));
  });

  return {
    messages: [...serverMessages, ...stillPending],
    pendingMessages: stillPending,
  };
}
