/**
 * Pure context reducers + small side-effect helpers used by the chat
 * machine's action arrays. Extracting them keeps `chatMachine.ts` focused
 * on state wiring and de-duplicates the SEND-while-busy logic shared by the
 * `streaming` and `refreshing` states. None of these touch React, so they
 * are safe ordinary functions.
 */

import { interruptChat, type PendingSessionEntry, type SessionEntry } from "../../api";
import { buildOptimisticContent, entryText, reconcilePending } from "./chat-shared";
import type { OutputFrom } from "xstate";
import { queueMessageToBackend, rollupStreamToEntry, type fetchHistoryActor } from "./chat-actors";
import { toastError } from "../../components/ui/toast-store";
import { MAX_RETAINED_MESSAGES, type ChatContext, type ChatEvent } from "../chat-types";
import { boxNow } from "../../lib/box-clock";
import { observeChatSendHistory } from "../../lib/chat-send-diagnostics";
import type { ChatSendContext } from "@core/chat/card-activity.js";

type SendEvent = Extract<ChatEvent, { type: "SEND" }>;

/**
 * Fire the interrupt request for the live turn. A user-initiated action, so a
 * failure is never swallowed (engineering principle 4): the turn keeps
 * streaming on failure, so surface it via the toast channel and log rather
 * than dropping it. Fire-and-forget — the machine has already set
 * `interrupting`; this only reports if the request itself fails.
 */
export function sendInterrupt(sessionId: string): void {
  interruptChat({ sessionId }).catch((e: unknown) => {
    console.error(`[chatfsm] interrupt failed for session ${sessionId}:`, e);
    toastError("Couldn't stop the reply", { cause: e });
  });
}

/** Pull the companion-card fields off a SEND event, omitting empties — shared
 *  by the streaming input builder and the queued-send dispatcher. */
export function cardFieldsFromEvent(event: SendEvent): ChatSendContext & Pick<SendEvent, "binding" | "startup"> {
  return {
    ...(event.startup !== undefined ? { startup: event.startup } : {}),
    ...(event.binding !== undefined ? { binding: event.binding } : {}),
    ...(event.openCard !== undefined ? { openCard: event.openCard } : {}),
    ...(event.cardActivity && event.cardActivity.length > 0 ? { cardActivity: event.cardActivity } : {}),
    ...(event.cardState && Object.keys(event.cardState).length > 0 ? { cardState: event.cardState } : {}),
  };
}

/** Build the optimistic user entry appended when a SEND is queued. */
function buildPendingEntry(event: SendEvent, knownMessages: SessionEntry[]): PendingSessionEntry {
  return {
    uuid: event.messageId,
    type: "user",
    timestamp: new Date(boxNow()).toISOString(),
    content: buildOptimisticContent(event.message, event.images),
    pending: true,
    reconcileKnownUuids: knownMessages.map((message) => message.uuid),
  };
}

/**
 * SEND received while the agent is busy (streaming or refreshing): append a
 * dimmed pending bubble and track it for reconcile. Shared by both states.
 */
export function appendQueuedSend(
  { context, event }: { context: ChatContext; event: SendEvent },
): Pick<ChatContext, "messages" | "pendingMessages"> {
  const entry = buildPendingEntry(event, context.messages);
  return {
    messages: [...context.messages, entry],
    pendingMessages: [...context.pendingMessages, entry],
  };
}

/**
 * Fire the queued message at the backend; the chat-complete SSE triggers
 * refresh. A refusal comes back as SEND_REFUSED, so the optimistic entry says
 * it was not delivered instead of looking queued until it ages out.
 */
export function dispatchQueuedSend(
  { context, event, self }: { context: ChatContext; event: SendEvent; self: { send: (event: ChatEvent) => void } },
): void {
  queueMessageToBackend({
    session: context.sessionInput,
    message: event.message,
    messageId: event.messageId,
    ...(event.images ? { images: event.images } : {}),
    ...cardFieldsFromEvent(event),
    onRefused: () => self.send({ type: "SEND_REFUSED", messageId: event.messageId }),
  });
}

/** OTHER_USER_MESSAGE (global): append a message another user sent (via SSE broadcast). */
export function appendOtherUserMessage(
  { context, event }: { context: ChatContext; event: Extract<ChatEvent, { type: "OTHER_USER_MESSAGE" }> },
): Pick<ChatContext, "messages"> {
  return {
    messages: [
      ...context.messages,
      {
        uuid: `other-${Date.now()}`,
        type: "user",
        timestamp: event.timestamp,
        content: [{ type: "text", text: event.message }],
        user: event.userName,
        ...(event.messageId !== undefined ? { messageId: event.messageId } : {}),
      },
    ],
  };
}

/**
 * PREPEND_MESSAGES (global): prepend a page of older entries, bounded by
 * {@link MAX_RETAINED_MESSAGES}.
 *
 * A page that would overflow the ceiling is truncated from its *older* end —
 * its newest entries are the ones adjacent to what the tab already holds, so
 * the retained window stays contiguous — and once the ceiling is reached
 * further prepends are dropped. Trimming the newer end instead would evict the
 * live tail, which is where streaming lands. The load-older affordance hides
 * at the same threshold, so this is the backstop, not the user-visible stop.
 */
export function prependOlderMessages(
  { context, event }: { context: ChatContext; event: Extract<ChatEvent, { type: "PREPEND_MESSAGES" }> },
): Partial<Pick<ChatContext, "messages">> {
  const room = MAX_RETAINED_MESSAGES - context.messages.length;
  if (room <= 0) return {};
  const page = event.messages.length <= room
    ? event.messages
    : event.messages.slice(event.messages.length - room);
  return { messages: [...page, ...context.messages] };
}

/** STREAM_ERROR / STREAM_FAILED: surface the error and clear the live stream. */
export function applyStreamError(
  { context, event }: {
    context: ChatContext;
    event: Extract<ChatEvent, { type: "STREAM_ERROR" | "STREAM_FAILED" }>;
  },
): Pick<ChatContext, "error" | "streamText" | "streamTools"> & Partial<Pick<ChatContext, "pendingMessages">> {
  return {
    error: event.error,
    streamText: "",
    streamTools: [],
    // A failure before startChatTurn accepted the send cannot ever acquire a
    // durable echo. Stop protecting that optimistic entry so the refresh this
    // transition enters can truthfully remove it. Post-accept stream failures
    // retain it because the server may already have persisted the user turn.
    ...(event.type === "STREAM_FAILED" && !event.accepted
      ? { pendingMessages: context.pendingMessages.filter((entry) => entry.uuid !== context.liveTurnId) }
      : {}),
  };
}

/**
 * A chat that started as "new" learned its session id (SESSION_ASSIGNED, or a
 * refresh that looked the accepted turn up). Lock sends and history fetches
 * onto the real id, and drop the in-memory landmark binding: the backend has
 * persisted it to chat-session-history by now. (Pending seedFeatures are inert
 * from here: sessionInput is the real id, so they are never re-sent.)
 */
export function adoptSession(
  sessionId: string,
): Pick<ChatContext, "sessionInput" | "sessionId" | "contextDir" | "newChatTurnId"> {
  return { sessionInput: sessionId, sessionId, contextDir: undefined, newChatTurnId: undefined };
}

/** Shown when a turn's live view dropped and the box went idle with no reply. */
const NO_REPLY_ERROR = "The box stopped before it answered. Send your message again.";

/**
 * Settle a dropped live view (`replyLost`) against refreshed history. The
 * reply landed (history ends in assistant text): clear it with nothing shown,
 * since that drop was a transient. The box is still working: keep it, shown as
 * a warning, for the next refresh (chat-complete) to settle. The box is idle
 * with no reply: the turn really failed, so it becomes an error.
 */
// Reply first: busy is session-wide, so a queued next turn must not hold a
// warning for a reply already in history. A held REFRESH (`refreshAgain`) means
// the reply may have landed after this read (history and status are read
// concurrently), so no error yet: the extra fetch decides.
function settleLostReply(
  { context, messages, busy }: { context: ChatContext; messages: SessionEntry[]; busy: boolean },
): Partial<Pick<ChatContext, "replyLost" | "error">> {
  if (!context.replyLost) return {};
  const last = messages.at(-1);
  if (last?.type === "assistant" && entryText(last).length > 0) return { replyLost: false };
  return busy || context.refreshAgain ? {} : { replyLost: false, error: NO_REPLY_ERROR };
}

/** A legacy STREAM_BUSY rejects the active send before it can be persisted. */
export function untrackLastSend(
  { context }: { context: ChatContext },
): Pick<ChatContext, "messages" | "pendingMessages"> {
  return {
    messages: context.messages.filter((entry) => entry.uuid !== context.liveTurnId),
    pendingMessages: context.pendingMessages.filter((entry) => entry.uuid !== context.liveTurnId),
  };
}

/**
 * STREAM_ERROR / STREAM_FAILED when the user interrupted: the turn-ending
 * error is a user-initiated abort, not a failure — drop it and clear the
 * interrupt flag. streamText is left for `refreshing` to swap into history.
 */
export function clearInterrupt(): Pick<ChatContext, "interrupting" | "error" | "replyLost"> {
  return { interrupting: false, error: null, replyLost: false };
}

/** Every `streaming → refreshing` edge: this refresh reconciles a turn the agent just ran. */
export function markTurnRefresh(): Pick<ChatContext, "refreshCause"> {
  return { refreshCause: "turn" };
}

/** SET_MESSAGES (global): reconcile a server-pushed message set against pending. */
export function applyServerMessages(
  { context, event }: { context: ChatContext; event: Extract<ChatEvent, { type: "SET_MESSAGES" }> },
): Pick<ChatContext, "messages" | "pendingMessages" | "sessionId"> {
  const reconciled = reconcilePendingWithDiagnostics({
    serverMessages: event.messages,
    pendingMessages: context.pendingMessages,
  });
  return {
    messages: reconciled.messages,
    pendingMessages: reconciled.pendingMessages,
    sessionId: event.sessionId,
  };
}

/** Reconcile durable history and mark every pending emission it confirmed. */
export function reconcilePendingWithDiagnostics(params: {
  serverMessages: SessionEntry[];
  pendingMessages: PendingSessionEntry[];
}): ReturnType<typeof reconcilePending> {
  const reconciled = reconcilePending(params);
  const stillPending = new Set(reconciled.pendingMessages.map((entry) => entry.uuid));
  observeChatSendHistory(params.pendingMessages
    .filter((entry) => entryText(entry).length > 0 && !stillPending.has(entry.uuid))
    .map((entry) => entry.uuid));
  return reconciled;
}

/**
 * STREAM_QUEUED: mark the active optimistic user message as queued so it
 * stays visible dimmed until the server processes the turn. Ordinary sends
 * are already tracked for reconciliation without this visual flag.
 */
export function promoteLastToPending(
  { context }: { context: ChatContext },
): Partial<ChatContext> {
  if (context.liveTurnId === null) return {};
  const active = context.pendingMessages.find((entry) => entry.uuid === context.liveTurnId);
  if (!active || active.pending === true) return {};
  const promoted: PendingSessionEntry = { ...active, pending: true };
  const alreadyTracked = context.pendingMessages.some((entry) => entry.uuid === active.uuid);
  return {
    messages: context.messages.map((entry) => entry.uuid === active.uuid ? promoted : entry),
    pendingMessages: alreadyTracked
      ? context.pendingMessages.map((entry) => entry.uuid === active.uuid ? promoted : entry)
      : [...context.pendingMessages, promoted],
  };
}

/**
 * `refreshing`'s onDone: swap fetched history in. A still-"new" chat with no
 * id has no history, so the streamed reply is rolled up in place instead.
 */
export function applyRefreshedHistory(
  { context, output }: { context: ChatContext; output: OutputFrom<typeof fetchHistoryActor> },
): Partial<ChatContext> {
  // A "new" chat whose id came from the accepted turn's lookup
  // (fetchHistory) adopts it, as SESSION_ASSIGNED would, and
  // reconciles below like any other session.
  const adopted = context.sessionInput === "new" ? output.sessionId : null;
  // Still "new" with no id: fetchHistory returned empty. Roll up
  // whatever streamed for this turn into a synthetic assistant entry
  // so the completed response stays visible until a later refresh
  // or a remount loads the authoritative copy.
  if (context.sessionInput === "new" && adopted === null) {
    const synthetic = rollupStreamToEntry(context.streamText, context.streamTools);
    const messages = synthetic ? [...context.messages, synthetic] : context.messages;
    return {
      // No history to check: nothing streamed stays a warning until remount.
      ...(synthetic ? settleLostReply({ context, messages, busy: false }) : {}),
      messages,
      streamText: "",
      streamTools: [],
    };
  }
  const reconciled = reconcilePendingWithDiagnostics({
    serverMessages: output.entries,
    pendingMessages: context.pendingMessages,
  });
  return {
    ...(adopted !== null ? adoptSession(adopted) : {}),
    ...settleLostReply({ context, messages: reconciled.messages, busy: output.busy }),
    messages: reconciled.messages,
    pendingMessages: reconciled.pendingMessages,
    sessionId: output.sessionId,
    totalEntries: output.total,
    processRunning: output.running,
    processBusy: output.busy,
    streamText: "",
    streamTools: [],
  };
}
