/**
 * Pure helpers shared by chat machines. Kept free of tRPC / SSE / API
 * concerns so machines can drop them in unchanged.
 */

// Relative (not `@shared/…`): this file is imported directly by Node/tsx in
// tests (no Vite bundler in that path to resolve the aliased specifier),
// same reasoning as components/view-widgets/node-entry.tsx.
import { buildChatContentBlocks, IMAGE_NOT_DISPLAYED } from "../../../../shared/chat-content-blocks";
import type {
  SessionEntry,
  PendingSessionEntry,
  SessionContentBlock,
  ChatImageAttachment,
} from "../../api";

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
 * Strip attributes from human-input wrapper opening tags so the optimistic
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
    // `#?` so it matches the pre-2026-08-25 form too: the three copies of one
    // message can be from different eras (an old transcript entry against a
    // fresh optimistic one), and a normalizer that only knew one form would
    // leave the token in on one side and strip it on the other — turning a
    // match into a mismatch, which is this whole function's failure mode.
    .replace(/\[image#?\d+]/g, "")
    .replace(/<(typed|speech|external-input)\b[^>]*>/g, "<$1>");
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
 * So an accepted entry is dropped when something already pending is the same
 * send: the same message id (an optimistic copy's uuid is its message id), or,
 * for a row from a box that records no id, the same text compared through the
 * same normalizer reconciliation uses. Text alone would pair two identical
 * sends crosswise, and when only one of them was dropped the wrong bubble
 * would say so. The matched copy takes the box's word on delivery
 * (`undelivered`, `hadImages`). A repeated load cannot stack copies of one bus
 * row, because the row's uuid is checked too.
 */
export function mergeAcceptedIntoPending(params: {
  pendingMessages: PendingSessionEntry[];
  accepted: PendingSessionEntry[];
}): PendingSessionEntry[] {
  const { pendingMessages, accepted } = params;
  if (accepted.length === 0) return pendingMessages;
  const merged = [...pendingMessages];
  const seenUuids = new Set(pendingMessages.map((pm) => pm.uuid));
  const seenText = pendingMessages.map((pm) => normalizeForCompare(entryText(pm))).filter((t) => t !== "");
  const fresh = accepted.filter((entry) => {
    if (entry.messageId !== undefined) {
      const at = merged.findIndex((pm) => (pm.messageId ?? pm.uuid) === entry.messageId);
      const match = merged[at];
      if (match === undefined) return !seenUuids.has(entry.uuid);
      merged[at] = {
        ...match,
        ...(entry.undelivered === true ? { undelivered: true as const } : {}),
        ...(entry.hadImages === true ? { hadImages: true as const } : {}),
      };
      return false;
    }
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
  return [...merged, ...fresh];
}

/** Mark the pending entry for this send undelivered, in both lists; null when none is pending. */
export function markPendingUndelivered(params: {
  messages: SessionEntry[];
  pendingMessages: PendingSessionEntry[];
  messageId: string;
  refused?: boolean;
}): { messages: SessionEntry[]; pendingMessages: PendingSessionEntry[] } | null {
  const { messages, pendingMessages, messageId, refused } = params;
  const uuids = new Set(pendingMessages.filter((pm) => (pm.messageId ?? pm.uuid) === messageId).map((pm) => pm.uuid));
  if (uuids.size === 0) return null;
  const mark = <T extends SessionEntry>(entry: T): T => uuids.has(entry.uuid)
    ? { ...entry, undelivered: true, ...(refused === true ? { sendRefused: true } : {}) }
    : entry;
  return { messages: messages.map(mark), pendingMessages: pendingMessages.map(mark) };
}

/** Remove a discarded send's pending entry from both lists. */
export function removePendingSend(params: {
  messages: SessionEntry[];
  pendingMessages: PendingSessionEntry[];
  messageId: string;
}): { messages: SessionEntry[]; pendingMessages: PendingSessionEntry[] } {
  const { messages, pendingMessages, messageId } = params;
  const uuids = new Set(pendingMessages.filter((pm) => (pm.messageId ?? pm.uuid) === messageId).map((pm) => pm.uuid));
  return {
    messages: messages.filter((entry) => !uuids.has(entry.uuid)),
    pendingMessages: pendingMessages.filter((entry) => !uuids.has(entry.uuid)),
  };
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

  // Transcript turns that echo an earlier send: a later unreconciled message
  // was sent after them even when its baseline predates their writing. They
  // are kept on the entry, because the earlier send is gone from the pending
  // list after this pass.
  const echoesSoFar: string[] = [];
  const stillPending: PendingSessionEntry[] = [];
  for (const pm of pendingMessages) {
    const pmText = normalizeForCompare(entryText(pm));
    if (pmText.length === 0) continue;
    // An earlier send's echo from a previous pass is not this send's echo: a
    // second identical "yes" must not be confirmed by the first one's turn on
    // the next refresh. Within one pass a merged queued turn still confirms both.
    const baseline = new Set([...pm.reconcileKnownUuids, ...pm.sentAfterEchoes ?? []]);
    const echo = serverUsers.find((server) => {
      return !baseline.has(server.uuid) && server.remainingText.includes(pmText);
    });
    if (echo) {
      echo.remainingText = echo.remainingText.replace(pmText, "");
      echoesSoFar.push(echo.uuid);
      continue;
    }
    const earlier = (pm.sentAfterEchoes ?? []).filter((uuid) => !echoesSoFar.includes(uuid));
    stillPending.push(echoesSoFar.length === 0 ? pm : { ...pm, sentAfterEchoes: [...earlier, ...echoesSoFar] });
  }

  return {
    messages: placePending(serverMessages, stillPending),
    pendingMessages: stillPending,
  };
}

/**
 * Where each unreconciled message goes. Normally after everything: it is the
 * newest thing in the chat. But once the transcript holds a user turn after
 * everything the message was sent after (its `reconcileKnownUuids` baseline,
 * plus the echoes of earlier sends), the agent has moved on without it (a send
 * refused as busy, a queue dropped by a restart). At the end it read as the
 * newest message, below turns that came later
 * (`issues/bugs/2026-10-14-busy-rejected-send-recorded-then-orphaned.md`).
 * Such a message sits just before that later user turn. The baseline is used
 * rather than timestamps because an optimistic copy is stamped by the client's
 * clock and the transcript by the box's. With no baseline entry in the
 * transcript (an empty or unavailable history when it was sent) there is
 * nothing to place it after, and it stays last.
 */
function placePending(serverMessages: SessionEntry[], pendingMessages: PendingSessionEntry[]): SessionEntry[] {
  const messages = [...serverMessages];
  for (const pending of pendingMessages) {
    const sentAfter = new Set([...pending.reconcileKnownUuids, ...pending.sentAfterEchoes ?? []]);
    const anchor = serverMessages.findLastIndex((entry) => sentAfter.has(entry.uuid));
    const later = anchor === -1 ? undefined : serverMessages.slice(anchor + 1).find((entry) => entry.type === "user");
    // Inserting before the same turn again keeps several such messages in order.
    const index = later === undefined ? messages.length : messages.indexOf(later);
    messages.splice(index, 0, pending);
  }
  return messages;
}

/**
 * Show a message the box injected into this chat (a delivered `<capture>` or
 * `<upload>`) from the moment it is announced, rather than from the moment the
 * transcript has it.
 *
 * The box announces the message once its turn is dispatched; the agent writes
 * it to the transcript a little later. The refresh the announcement triggers
 * can land in that gap, and the next refresh comes only when the turn ends, so
 * the message was missing for the whole reply (20 to 50 seconds in a
 * 2026-10-16 trace). Holding it as pending is what a page load already does
 * with the box's record of accepted messages (`mergeAcceptedIntoPending`);
 * `reconcilePending` retires it once the transcript catches up.
 *
 * The baseline is every message already shown, so only a new transcript entry
 * retires it. A message the transcript already holds is left alone: with that
 * entry in the baseline it could never be retired.
 */
export function holdInjectedMessage(params: {
  messages: SessionEntry[];
  pendingMessages: PendingSessionEntry[];
  message: string;
  timestamp: string;
}): { messages: SessionEntry[]; pendingMessages: PendingSessionEntry[] } {
  const { messages, pendingMessages, message, timestamp } = params;
  const unchanged = { messages, pendingMessages };
  const text = normalizeForCompare(message);
  if (text === "") return unchanged;
  const pendingUuids = new Set(pendingMessages.map((pm) => pm.uuid));
  const landed = messages.some((entry) => entry.type === "user" && !pendingUuids.has(entry.uuid)
    && normalizeForCompare(entryText(entry)).includes(text));
  if (landed) return unchanged;
  const entry: PendingSessionEntry = {
    uuid: `injected-${timestamp}`,
    type: "user",
    timestamp,
    content: [{ type: "text", text: message }],
    reconcileKnownUuids: messages.map((m) => m.uuid),
  };
  const merged = mergeAcceptedIntoPending({ pendingMessages, accepted: [entry] });
  if (merged.length === pendingMessages.length) return unchanged;
  return { messages: [...messages, entry], pendingMessages: merged };
}
