/**
 * The chat machine's handling of a send the agent never got
 * (`docs/plans/chat-not-delivered.md`): the box dropped it from a stopped
 * queue (`chat-user-message-undelivered`), or refused a queued send outright.
 * Split from `machine.ts` and `chat-actions.ts` for their line budgets.
 */

import type { PendingSessionEntry } from "../../api";
import { trpcClient } from "../../lib/trpc/client";
import { chatTailSlice, type ChatContext, type ChatEvent } from "../chat-types";
import { markPendingUndelivered, mergeAcceptedIntoPending, removePendingSend } from "./chat-shared";
import { reconcilePendingWithDiagnostics } from "./chat-actions";

type ListsUpdate = Pick<ChatContext, "messages" | "pendingMessages">;

/**
 * The box's accepted list for a session. `chat.bootstrap` is the only read
 * that carries it (`pending`); a history refresh does not.
 */
async function fetchAcceptedMessages(sessionId: string): Promise<PendingSessionEntry[]> {
  const data = await trpcClient.chat.bootstrap.query({ session: sessionId, slice: chatTailSlice() });
  return data.pending;
}

/**
 * An undelivered send this tab holds no entry for: another user's message, or
 * one sent from another tab (this tab ignores its own user's broadcast). The
 * box's accepted list has it, marked; it comes back as ACCEPTED_REFETCHED.
 */
export function refetchAccepted({ context, self }: { context: ChatContext; self: { send: (event: ChatEvent) => void } }): void {
  if (context.sessionId === null) return;
  const sessionId = context.sessionId;
  fetchAcceptedMessages(sessionId).then(
    (accepted) => self.send({ type: "ACCEPTED_REFETCHED", accepted }),
    (e: unknown) => console.error(`[chatfsm] accepted-message refetch failed for session ${sessionId}:`, e),
  );
}

/**
 * ACCEPTED_REFETCHED (global): fold the box's accepted list in, as a page load
 * does, without replacing the history this tab holds. A copy of another
 * user's message shown from the live broadcast is not pending, so the
 * accepted copy of the same send takes its place.
 */
export function applyRefetchedAccepted(
  { context, event }: { context: ChatContext; event: Extract<ChatEvent, { type: "ACCEPTED_REFETCHED" }> },
): Pick<ChatContext, "messages" | "pendingMessages"> {
  const pendingUuids = new Set(context.pendingMessages.map((entry) => entry.uuid));
  const acceptedIds = new Set(event.accepted.flatMap((entry) => entry.messageId ?? []));
  const serverMessages = context.messages.filter((entry) => !pendingUuids.has(entry.uuid)
    && !(entry.messageId !== undefined && acceptedIds.has(entry.messageId)));
  return reconcilePendingWithDiagnostics({
    serverMessages,
    pendingMessages: mergeAcceptedIntoPending({ pendingMessages: context.pendingMessages, accepted: event.accepted }),
  });
}

/** SEND_REFUSED (global): the box refused a queued send (`dispatchQueuedSend`) and recorded nothing. */
export function markRefusedSend(
  { context, event }: { context: ChatContext; event: Extract<ChatEvent, { type: "SEND_REFUSED" }> },
): Partial<ListsUpdate> {
  return markPendingUndelivered({ messages: context.messages, pendingMessages: context.pendingMessages, messageId: event.messageId, refused: true }) ?? {};
}

/** MESSAGE_DISCARDED (global): an undelivered send was discarded, here or in another tab. */
export function discardPendingSend(
  { context, event }: { context: ChatContext; event: Extract<ChatEvent, { type: "MESSAGE_DISCARDED" }> },
): ListsUpdate {
  return removePendingSend({ messages: context.messages, pendingMessages: context.pendingMessages, messageId: event.messageId });
}
