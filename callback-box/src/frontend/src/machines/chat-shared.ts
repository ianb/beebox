/**
 * Pure helpers shared by chat machines. Kept free of tRPC / SSE / API
 * concerns so machines can drop them in unchanged.
 */

// Relative (not `@shared/…`): this file is imported directly by Node/tsx in
// doctests (no Vite bundler in that path to resolve the aliased specifier),
// same reasoning as components/view-widgets/node-entry.tsx.
import { buildChatContentBlocks, IMAGE_NOT_DISPLAYED } from "../../../shared/chat-content-blocks";
import type {
  SessionEntry,
  PendingSessionEntry,
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
  // A stripped image comes back as placeholder TEXT, so the server's copy of a
  // turn carries characters the client's optimistic copy never had — the images
  // there are still image blocks, contributing nothing to the text. Comparing
  // the two verbatim then fails, the pending entry is never retired, and the
  // user sees their own message twice: once with their photos, once with grey
  // placeholders. Observed in a journey walk, 2026-08-24.
  return text
    .replaceAll(IMAGE_NOT_DISPLAYED, "")
    // `[imageN]` tokens are consumed into image blocks by whichever side built
    // the entry, so a side that did not build image blocks (the box's record of
    // an accepted message — the bytes never reached the bus) still carries
    // them. Dropping them here keeps every comparison between the three copies
    // of one message symmetric, including the orphan-token case the shared
    // builder deliberately leaves as literal text.
    .replace(/\[image\d+]/g, "")
    .replace(/<(typed|speech)\b[^>]*>/g, "<$1>");
}

/**
 * Fold the box's own record of accepted-but-not-durable messages into this
 * machine's optimistic ones.
 *
 * The two lists describe the same events from different sides: `pendingMessages`
 * is what this page sent and is still waiting on, `accepted` is what the box
 * says it took (`chat.bootstrap`'s `pending`). On a fresh load the first is
 * empty and the second is everything. In the narrow window where a send lands
 * while the initial fetch is still in flight they overlap, and appending
 * blindly would render that message twice — once from each side.
 *
 * So an accepted entry is dropped when something already pending carries the
 * same text, compared through the same normalizer reconciliation uses, and
 * again by uuid so a repeated load cannot stack copies of one bus row.
 */
export function mergeAcceptedIntoPending(params: {
  pendingMessages: PendingSessionEntry[];
  accepted: PendingSessionEntry[];
}): PendingSessionEntry[] {
  const { pendingMessages, accepted } = params;
  if (accepted.length === 0) return pendingMessages;
  const seenUuids = new Set(pendingMessages.map((pm) => pm.uuid));
  const seenText = pendingMessages.map((pm) => normalizeForCompare(entryText(pm))).filter((t) => t !== "");
  const fresh = accepted.filter((entry) => {
    if (seenUuids.has(entry.uuid)) return false;
    const text = normalizeForCompare(entryText(entry));
    const at = seenText.indexOf(text);
    // Consume the match, so two identical messages the person really did send
    // twice are not collapsed into one by a single optimistic copy.
    if (text !== "" && at !== -1) {
      seenText.splice(at, 1);
      return false;
    }
    seenUuids.add(entry.uuid);
    return true;
  });
  return [...pendingMessages, ...fresh];
}

/**
 * After fetching server history, filter out pending messages that the server
 * has caught up to, then append remaining pending messages so they stay visible.
 *
 * The backend's drainQueue() combines multiple queued messages into one turn
 * (joined with \n\n), so we use substring matching: a pending message is
 * considered delivered if its (normalized) text appears as a substring of a
 * server user message whose UUID was not present when that pending entry was
 * created. Matches consume one occurrence, so one durable "yes" cannot confirm
 * two pending "yes" sends while a merged queued turn can confirm both.
 */
export function reconcilePending(params: {
  serverMessages: SessionEntry[];
  pendingMessages: PendingSessionEntry[];
}): { messages: SessionEntry[]; pendingMessages: PendingSessionEntry[] } {
  const { serverMessages, pendingMessages } = params;
  if (pendingMessages.length === 0) {
    return { messages: serverMessages, pendingMessages: [] };
  }

  const serverUsers: Array<{ uuid: string; remainingText: string }> = [];
  for (const entry of serverMessages.toReversed()) {
    if (serverUsers.length >= pendingMessages.length + 5) break;
    if (entry.type === "user") {
      serverUsers.push({
        uuid: entry.uuid,
        remainingText: normalizeForCompare(entryText(entry)),
      });
    }
  }
  serverUsers.reverse();

  const stillPending = pendingMessages.filter((pm) => {
    const pmText = normalizeForCompare(entryText(pm));
    if (pmText.length === 0) return false;
    const baseline = new Set(pm.reconcileKnownUuids);
    const echo = serverUsers.find((server) => {
      return !baseline.has(server.uuid) && server.remainingText.includes(pmText);
    });
    if (!echo) return true;
    echo.remainingText = echo.remainingText.replace(pmText, "");
    return false;
  });

  return {
    messages: [...serverMessages, ...stillPending],
    pendingMessages: stillPending,
  };
}
