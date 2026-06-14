/**
 * Pure context reducers + small side-effect helpers used by the chat
 * machine's action arrays. Extracting them keeps `chatMachine.ts` focused
 * on state wiring and de-duplicates the SEND-while-busy logic shared by the
 * `streaming` and `refreshing` states. None of these touch React, so they
 * are safe ordinary functions.
 */

import type { SessionEntry } from "../api";
import { buildOptimisticContent, reconcilePending } from "./chat-shared";
import { queueMessageToBackend } from "./chat-actors";
import type { ChatContext, ChatEvent } from "./chat-types";

type SendEvent = Extract<ChatEvent, { type: "SEND" }>;

/** Build the optimistic, pending user entry appended when a SEND is queued. */
function buildPendingEntry(event: SendEvent): SessionEntry {
  return {
    uuid: `user-${Date.now()}`,
    type: "user",
    timestamp: new Date().toISOString(),
    content: buildOptimisticContent(event.message, event.images),
    pending: true,
  };
}

/**
 * SEND received while the agent is busy (streaming or refreshing): append a
 * dimmed pending bubble and track it for reconcile. Shared by both states.
 */
export function appendQueuedSend(
  { context, event }: { context: ChatContext; event: SendEvent },
): Pick<ChatContext, "messages" | "pendingMessages"> {
  const entry = buildPendingEntry(event);
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
  { event }: { event: Extract<ChatEvent, { type: "STREAM_ERROR" | "STREAM_FAILED" }> },
): Pick<ChatContext, "error" | "streamText" | "streamTools"> {
  return { error: event.error, streamText: "", streamTools: [] };
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
 * STREAM_QUEUED: promote the just-added optimistic user message to pending so
 * reconcile keeps it visible (dimmed) until the server processes the queued
 * turn. No-op if the last message isn't a fresh, unpromoted user message.
 */
export function promoteLastToPending(
  { context }: { context: ChatContext },
): Partial<ChatContext> {
  const last = context.messages[context.messages.length - 1];
  if (!last || last.type !== "user") return {};
  if (context.pendingMessages.some((p) => p.uuid === last.uuid)) return {};
  const promoted: SessionEntry = { ...last, pending: true };
  return {
    messages: [...context.messages.slice(0, -1), promoted],
    pendingMessages: [...context.pendingMessages, promoted],
  };
}
