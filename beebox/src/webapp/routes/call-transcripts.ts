/**
 * Call transcription for one box (docs/plans/chat-calls.md, Track G): keep
 * each transcribed call's fold record current from the room's call changes
 * and the box's card changes, fold and deliver the `<call>` message when the
 * call ends, and at startup fold the calls a restart left behind.
 */

import type { FastifyInstance } from "fastify";
import type { EventBus } from "../../core/event-bus/core.js";
import { recordCallChange, recordCardChange, recordChatMessage } from "../../core/chat/call-transcript/record.js";
import { foldAndDeliver, resumeCallFolds, type CallFoldDeps } from "../../core/chat/call-transcript/deliver/core.js";
import { deliverUserMessage } from "../../core/chat/session/deliver-user-message.js";
import { getDirectoryForSession } from "../../core/chat/session/history.js";
import { getChatRuntime } from "../chat-runtime.js";
import { stripSpeechWrappers } from "../../cli/lib/session.js";
import { observeCalls } from "../trpc/chat-room.js";

class ChatRuntimeMissingError extends Error {
  constructor(boxRoot: string) {
    super(`No chat runtime for box ${boxRoot}; the call transcript stays in its fold record`);
    this.name = "ChatRuntimeMissingError";
  }
}

export function registerCallTranscripts(opts: { server: FastifyInstance; boxRoot: string; eventBus: EventBus }): void {
  const { server, boxRoot, eventBus } = opts;
  /** Calls in this box with a fold record that are still going on, and each one's chat. */
  const recorded = new Map<string, string>();
  const deps: CallFoldDeps = {
    boxRoot,
    eventBus,
    deliver: async ({ sessionId, message }) => {
      const runtime = getChatRuntime(boxRoot);
      if (runtime === undefined) throw new ChatRuntimeMissingError(boxRoot);
      const target = { sessionId, contextDir: await getDirectoryForSession(boxRoot, sessionId) };
      await deliverUserMessage({ boxRoot, registry: runtime.registry, eventBus, wireSession: runtime.wireSession, target, message, logPrefix: "call-transcript" });
    },
  };
  const fold = (callId: string): void => {
    void foldAndDeliver(deps, callId).catch((e: unknown) => {
      console.error(`[call-transcript] Folding call ${callId} failed; its record stays for the next start:`, e);
    });
  };

  const stopObserving = observeCalls((snapshot, change) => {
    if (snapshot.boxRoot !== boxRoot) return;
    // Known at once, before the record is written: a message typed in that moment
    // queues behind the record's creation on its lock instead of being dropped.
    if (change.kind === "transcribing" && snapshot.transcribing) recorded.set(snapshot.callId, snapshot.sessionId);
    // Real time: the fold compares it with each device's clock.
    void recordCallChange(boxRoot, { snapshot, change, nowMs: Date.now() })
      .then((record) => {
        if (record === null) return;
        if (change.kind === "ended") {
          recorded.delete(snapshot.callId);
          fold(snapshot.callId);
        } else {
          recorded.set(snapshot.callId, snapshot.sessionId);
        }
      })
      .catch((e: unknown) => console.error(`[call-transcript] Could not record a change to call ${snapshot.callId}:`, e));
  });

  const cardChanges = eventBus.subscribe({
    listener: (event) => {
      if (event.event !== "file-change" || !event.data.path.endsWith(".card")) return;
      for (const callId of recorded.keys()) {
        void recordCardChange(boxRoot, { callId, path: event.data.path, atMs: Date.now() }).catch((e: unknown) => {
          console.error(`[call-transcript] Could not record a card change for call ${callId}:`, e);
        });
      }
    },
  });

  const chatMessages = eventBus.subscribe({
    listener: (event) => {
      if (event.event !== "chat-user-message" || event.data.user === null) return;
      const { sessionId, user, message } = event.data;
      const text = stripSpeechWrappers(message).replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
      if (text === "") return;
      for (const [callId, callSession] of recorded) {
        if (callSession !== sessionId) continue;
        // Real time, like every other line on the call's timeline.
        void recordChatMessage(boxRoot, { callId, message: { name: user.name, text, atMs: Date.now() } }).catch((e: unknown) => {
          console.error(`[call-transcript] Could not record a chat message for call ${callId}:`, e);
        });
      }
    },
  });

  void resumeCallFolds(deps, { isLive: (callId) => recorded.has(callId) }).catch((e: unknown) => {
    console.error("[call-transcript] Resuming call folds failed:", e);
  });

  server.addHook("onClose", async () => {
    stopObserving();
    cardChanges.unsubscribe();
    chatMessages.unsubscribe();
  });
}
