/**
 * The chat machine's initial context — split from `chatMachine.ts` for its
 * line budget. Pure: everything here is derived from the machine's input, and
 * the `"new"`-only fields (landmark binding, engine and model chosen before
 * the chat exists) are dropped for a resumed session, where the box already
 * holds the answers.
 */

import type { ChatContext, ChatMachineInput } from "./chat-types";

export function initialChatContext(input: ChatMachineInput): ChatContext {
  return {
    messages: [],
    pendingMessages: [],
    streamText: "",
    streamTools: [],
    streamNeedsSeparator: false,
    error: null,
    interrupting: false,
    sessionInput: input.sessionInput,
    sessionId: input.sessionInput === "new" ? null : input.sessionInput,
    ...(input.sessionInput === "new" && input.contextDir !== undefined
      ? { contextDir: input.contextDir }
      : {}),
    ...(input.sessionInput === "new" && input.startEngine !== undefined
      ? { startEngine: input.startEngine }
      : {}),
    ...(input.sessionInput === "new" && input.startModel !== undefined
      ? { startModel: input.startModel }
      : {}),
    processRunning: false,
    processBusy: false,
    totalEntries: 0,
    refreshCause: "resync" as const,
    liveTurnId: null,
    // Consumed by `loading` below and cleared on the way out, so nothing can
    // replay a stale preload if `loading` is ever re-entered.
    initial: input.initial,
    };
}
