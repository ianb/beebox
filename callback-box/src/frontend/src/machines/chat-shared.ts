/**
 * Pure helpers shared by chat machines. Kept free of tRPC / SSE / API
 * concerns so machines can drop them in unchanged.
 */

// Relative (not `@shared/…`): this file is imported directly by Node/tsx in
// doctests (no Vite bundler in that path to resolve the aliased specifier),
// same reasoning as components/view-widgets/node-entry.tsx.
import { buildChatContentBlocks } from "../../../shared/chat-content-blocks";
import type {
  SessionEntry,
  SessionContentBlock,
  ChatImageAttachment,
} from "../api";

/**
 * Build content blocks for the optimistic user message bubble displayed
 * before the server responds. Delegates the `[imageN]` token-parsing
 * algorithm to the shared `buildChatContentBlocks` (src/shared/chat-content-
 * blocks.ts) so this can't drift from the server-side `buildContentBlocks`
 * in chat-session-messages.ts — the local preview matches what gets stored
 * in the session log. Passes `ensureTrailingTextBlock: false`: the optimistic
 * bubble is discarded once the real server entry arrives, so it doesn't need
 * the stored log's "always has a text block" marker.
 */
export function buildOptimisticContent(
  message: string,
  images?: ChatImageAttachment[],
): SessionContentBlock[] {
  return buildChatContentBlocks<SessionContentBlock>({
    text: message,
    images: images ?? [],
    makeTextBlock: (text): SessionContentBlock => ({ type: "text", text }),
    makeImageBlock: (img): SessionContentBlock => ({
      type: "image",
      mediaType: img.mimeType,
      dataBase64: img.dataBase64,
    }),
    ensureTrailingTextBlock: false,
  });
}

/** Extract the text content from a session entry. */
export function entryText(entry: SessionEntry): string {
  return entry.content
    .filter((b): b is { type: "text"; text: string } => b.type === "text")
    .map((b) => b.text)
    .join("");
}

/**
 * Strip attributes from `<typed>` / `<speech>` opening tags so the optimistic
 * client-side text and the server-stored text compare equal. The server
 * injects `user="…" user-email="…"` (and the route may append `<pending-schedules>`
 * suffixes), neither of which the optimistic copy carries.
 */
function normalizeForCompare(text: string): string {
  return text.replace(/<(typed|speech)\b[^>]*>/g, "<$1>");
}

/**
 * After fetching server history, filter out pending messages that the server
 * has caught up to, then append remaining pending messages so they stay visible.
 *
 * The backend's drainQueue() combines multiple queued messages into one turn
 * (joined with \n\n), so we use substring matching: a pending message is
 * considered delivered if its (normalized) text appears as a substring of any
 * recent (normalized) server user message.
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
  for (const entry of serverMessages.toReversed()) {
    if (serverUserTexts.length >= pendingMessages.length + 5) break;
    if (entry.type === "user") {
      serverUserTexts.push(normalizeForCompare(entryText(entry)));
    }
  }

  const stillPending = pendingMessages.filter((pm) => {
    const pmText = normalizeForCompare(entryText(pm));
    return !serverUserTexts.some((st) => st === pmText || st.includes(pmText));
  });

  return {
    messages: [...serverMessages, ...stillPending],
    pendingMessages: stillPending,
  };
}
