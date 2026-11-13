/**
 * The process's one chat room registry, shared by `chatPresence` and `chatCall`
 * (docs/chat-presence.md, docs/chat-calls.md), and who a request is.
 */

import { createChatPresence, type CallChange, type CallSnapshot, type PresentPerson } from "../../core/chat/presence/room.js";
import { localUserName } from "../auth.js";
import type { TrpcContext } from "./context.js";

type CallObserver = (snapshot: CallSnapshot, change: CallChange) => void;
const callObservers = new Set<CallObserver>();

export const chatRoom = createChatPresence({
  onCallChange: (snapshot, change) => {
    for (const observe of callObservers) observe(snapshot, change);
  },
});

/** Hear every call change in this process; returns the unsubscribe. */
export function observeCalls(observe: CallObserver): () => void {
  callObservers.add(observe);
  return () => callObservers.delete(observe);
}

/** A chat session id as the client names it. */
export const SESSION_ID_RE = /^[\w-]{8,64}$/;

/**
 * The person this request is, or null when it is no person: the box's own agent
 * (its bearer, or its browser on a box that lets it act as the owner) and an
 * open-access box with no identity are never shown as present and never join calls.
 */
export function personFor(ctx: TrpcContext): PresentPerson | null {
  if (ctx.user === null || ctx.actor === "agent") return null;
  const { email, name } = ctx.user;
  // A paired device carries only the email; the local-user store may know the name.
  return { email, name: name === email ? (localUserName(email) ?? email) : name };
}
