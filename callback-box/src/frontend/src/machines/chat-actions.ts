/**
 * Pure context reducers + small side-effect helpers used by the chat
 * machine's action arrays. Extracting them keeps `chatMachine.ts` focused
 * on state wiring and de-duplicates the SEND-while-busy logic shared by the
 * `streaming` and `refreshing` states. None of these touch React, so they
 * are safe ordinary functions.
 */

import { interruptChat, type PendingSessionEntry, type SessionEntry } from "../api";
import { buildOptimisticContent, reconcilePending } from "./chat-shared";
import { queueMessageToBackend } from "./chat-actors";
import { toastError } from "../components/ui/toast-store";
import type { ChatContext, ChatEvent } from "./chat-types";

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
    toastError("Failed to interrupt the agent", { cause: e });
  });
}

/** Pull the companion-card fields off a SEND event, omitting empties — shared
 *  by the streaming input builder and the queued-send dispatcher. */
export function cardFieldsFromEvent(event: SendEvent): Pick<SendEvent, "openCard" | "cardActivity" | "cardState"> {
  return {
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
    timestamp: new Date().toISOString(),
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

/** Fire the queued message at the backend; the chat-complete SSE triggers refresh. */
export function dispatchQueuedSend(
  { context, event }: { context: ChatContext; event: SendEvent },
): void {
  queueMessageToBackend({
    session: context.sessionInput,
    message: event.message,
    messageId: event.messageId,
    ...(event.images ? { images: event.images } : {}),
    ...cardFieldsFromEvent(event),
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
      },
    ],
  };
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
export function clearInterrupt(): Pick<ChatContext, "interrupting" | "error"> {
  return { interrupting: false, error: null };
}

/** SET_MESSAGES (global): reconcile a server-pushed message set against pending. */
export function applyServerMessages(
  { context, event }: { context: ChatContext; event: Extract<ChatEvent, { type: "SET_MESSAGES" }> },
): Pick<ChatContext, "messages" | "pendingMessages" | "sessionId"> {
  const reconciled = reconcilePending({
    serverMessages: event.messages,
    pendingMessages: context.pendingMessages,
  });
  return {
    messages: reconciled.messages,
    pendingMessages: reconciled.pendingMessages,
    sessionId: event.sessionId,
  };
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
