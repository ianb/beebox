/**
 * XState machine for chat session lifecycle.
 *
 * States: loading → idle ⇄ streaming → refreshing → idle
 *
 * The SSE stream lives in a callback actor's closure.
 * Serializable context holds messages, stream text, error, session info.
 * Voice turn-taking coordination stays in the component layer.
 */

import { setup, assign } from "xstate";
import { invariant } from "@shared/invariant";
import { buildOptimisticContent, reconcilePending } from "./chat-shared";
import {
  chatTailSlice,
  logFsm,
  type ChatContext,
  type ChatEvent,
  type ChatMachineInput,
} from "./chat-types";
import {
  fetchInitialActor,
  fetchHistoryActor,
  streamActor,
  rollupStreamToEntry,
} from "./chat-actors";
import {
  appendQueuedSend,
  dispatchQueuedSend,
  cardFieldsFromEvent,
  applyServerMessages,
  appendOtherUserMessage,
  promoteLastToPending,
  applyStreamError,
  clearInterrupt,
  sendInterrupt,
} from "./chat-actions";

export { chatTailSlice };

// -- Machine --

export const chatMachine = setup({
  types: {
    context: {} as ChatContext,
    events: {} as ChatEvent,
    input: {} as ChatMachineInput,
  },
  actors: {
    fetchInitial: fetchInitialActor,
    fetchHistory: fetchHistoryActor,
    stream: streamActor,
  },
}).createMachine({
  id: "chat",
  initial: "loading",
  context: ({ input }) => ({
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
    processRunning: false,
    processBusy: false,
    totalEntries: 0,
    liveTurnId: null,
    // Consumed by `loading` below and cleared on the way out, so nothing can
    // replay a stale preload if `loading` is ever re-entered.
    initial: input.initial,
  }),
  on: {
    // Global handler: directly set messages from any state (used by server-push updates)
    SET_MESSAGES: {
      actions: assign(applyServerMessages),
    },
    // Global handler: refresh history from any state (e.g., after SSE chat-complete)
    REFRESH: {
      target: ".refreshing",
      actions: [
        ({ context }) => logFsm("refresh", {
          pending: context.pendingMessages.length,
          msgs: context.messages.length,
        }),
        assign({ streamText: "", streamTools: [] }),
      ],
    },
    // Global handler: another user sent a message (via SSE broadcast)
    OTHER_USER_MESSAGE: {
      actions: assign(appendOtherUserMessage),
    },
    // Global handler: prepend older messages loaded on demand
    PREPEND_MESSAGES: {
      actions: assign(({ context, event }) => ({
        messages: [...event.messages, ...context.messages],
      })),
    },
    // Global handler: record a pre-session chat-feature choice (e.g. narration
    // toggled on in a brand-new chat) to fold into the first send. Only while
    // still "new"; once an id is assigned, toggles go through the server.
    SET_SEED_FEATURE: {
      actions: assign(({ context, event }) => context.sessionId === null
        ? { seedFeatures: { ...context.seedFeatures, [event.feature]: event.value } }
        : {}),
    },
    // Global handler: backend assigned an id to a session that started as
    // "new". Lock subsequent sends and history fetches onto the real id so
    // we don't accidentally start another fresh session, and so refreshing
    // mid-stream uses the correct sessionInput rather than the "new" branch.
    SESSION_ASSIGNED: {
      actions: assign(({ event }) => ({
        sessionInput: event.sessionId,
        sessionId: event.sessionId,
        // Drop the in-memory binding now that the backend has persisted
        // it to chat-session-history; future resumes look it up there.
        // (Pending seedFeatures, if any, are now inert: sessionInput is the
        // real id so they're never re-sent, and toggles go through the server.)
        contextDir: undefined,
      })),
    },
  },
  states: {
    loading: {
      invoke: {
        src: "fetchInitial",
        input: ({ context }) => ({ sessionInput: context.sessionInput, initial: context.initial }),
        // `initial` is cleared on the way out either way, so nothing can
        // replay a stale preload if `loading` is ever re-entered.
        onDone: {
          target: "idle",
          actions: assign(({ event }) => ({
            messages: event.output.entries, sessionId: event.output.sessionId,
            processRunning: event.output.running, processBusy: event.output.busy,
            totalEntries: event.output.total, initial: undefined,
          })),
        },
        onError: {
          target: "idle",
          actions: assign(({ event }) => ({
            error: event.error instanceof Error ? event.error.message : "Failed to load",
            initial: undefined,
          })),
        },
      },
    },
    idle: {
      entry: ({ context }) => logFsm("enter-idle", {
        msgs: context.messages.length,
        pending: context.pendingMessages.length,
      }),
      on: {
        SEND: {
          target: "streaming",
          actions: [
            ({ event }) => logFsm("send-from-idle", { len: event.message.length }),
            assign(({ context, event }) => ({
              error: null,
              interrupting: false,
              streamText: "",
              streamTools: [],
              liveTurnId: event.messageId, // keys the live bubble across finalize
              messages: [
                ...context.messages,
                {
                  uuid: `user-${Date.now()}`,
                  type: "user" as const,
                  timestamp: new Date().toISOString(),
                  content: buildOptimisticContent(event.message, event.images),
                },
              ],
            })),
          ],
        },
        DISMISS_ERROR: { actions: assign({ error: null }) },
      },
    },
    streaming: {
      entry: ({ context }) => logFsm("enter-streaming", {
        msgs: context.messages.length,
        pending: context.pendingMessages.length,
      }),
      invoke: {
        id: "chatStream",
        src: "stream",
        input: ({ event, context }) => {
          // `streaming` is only ever entered by SEND (idle → streaming), so the
          // triggering event narrows to that variant — assert it rather than
          // cast past XState's broader event-union type on `input`.
          invariant(event.type === "SEND", "chatStream can only be invoked by a SEND event");
          return {
            sessionInput: context.sessionInput,
            message: event.message,
            messageId: event.messageId,
            ...(event.images && event.images.length > 0
              ? { images: event.images }
              : {}),
            ...(context.sessionInput === "new" && context.contextDir !== undefined
              ? { contextDir: context.contextDir }
              : {}),
            ...(context.sessionInput === "new" && context.seedFeatures ? { seedFeatures: context.seedFeatures } : {}),
            ...cardFieldsFromEvent(event),
          };
        },
      },
      on: {
        // Ignore REFRESH while streaming — STREAM_RESULT / STREAM_FAILED
        // handle termination. REFRESH arrives when the backend broadcasts
        // chat-complete on its /events bus, which races with the
        // per-turn SSE's STREAM_RESULT. If REFRESH won that race, we'd
        // transition to refreshing with a cleared streamText and never
        // play the <speech> that just arrived.
        REFRESH: {
          actions: () => logFsm("refresh-ignored-streaming"),
        },
        // Stalled-stream recovery (see STREAM_RECOVER in chat-types): honored
        // unlike REFRESH — sent only after the server confirms the turn is done.
        // Don't clear streamText/streamTools here (unlike STREAM_FAILED): the
        // refreshing onDone rolls them into a synthetic entry for a still-"new"
        // session whose history is empty, so clearing would lose the only copy
        // of a partial reply. refreshing clears them itself once it's done.
        STREAM_RECOVER: { target: "refreshing" },
        SEND: {
          // Queue the message — don't interrupt the current stream
          actions: [
            ({ event, context }) => logFsm("send-from-streaming", {
              len: event.message.length,
              pending: context.pendingMessages.length,
            }),
            assign(appendQueuedSend),
            dispatchQueuedSend,
          ],
        },
        STREAM_TEXT: {
          actions: assign(({ context, event }) => ({
            streamText: context.streamNeedsSeparator && context.streamText
              ? context.streamText + "\n\n" + event.text
              : context.streamText + event.text,
            streamNeedsSeparator: false,
          })),
        },
        STREAM_TOOL: {
          actions: assign(({ context, event }) => ({
            streamTools: [...context.streamTools, event.tool],
            streamNeedsSeparator: context.streamText.length > 0,
          })),
        },
        STREAM_BUSY: {
          target: "idle",
          actions: assign({
            error: "Agent is busy with another request",
          }),
        },
        STREAM_QUEUED: {
          target: "idle",
          // Backend was busy → this message is queued. Promote the just-added
          // optimistic user message to pending so reconcile keeps it visible
          // (dimmed) until the server has actually processed the queued turn.
          // Without this, the optimistic message is unprotected by reconcile
          // and there's no visible signal that work is still pending.
          actions: assign(promoteLastToPending),
        },
        // A user interrupt ends the turn with is_error — suppress that
        // (clearInterrupt) and refresh for the partial; otherwise show it.
        STREAM_ERROR: [
          { guard: ({ context }) => context.interrupting, target: "refreshing", actions: assign(clearInterrupt) },
          { target: "idle", actions: assign(applyStreamError) },
        ],
        STREAM_RESULT: "refreshing",
        STREAM_FAILED: [
          { guard: ({ context }) => context.interrupting, target: "refreshing", actions: assign(clearInterrupt) },
          // Go to refreshing instead of idle — the agent may still be
          // running on the server. Fetching history will pick up any
          // response that completed while we were disconnected.
          { target: "refreshing", actions: assign(applyStreamError) },
        ],
        INTERRUPT: {
          actions: [
            assign({ interrupting: true }),
            ({ context }) => {
              if (context.sessionId) sendInterrupt(context.sessionId);
            },
          ],
        },
      },
    },
    refreshing: {
      entry: ({ context }) => logFsm("enter-refreshing", {
        pending: context.pendingMessages.length,
      }),
      on: {
        // Ignore REFRESH here for the same reason `streaming` does, one state
        // later: `chat-complete` (→ REFRESH) lands a beat AFTER STREAM_RESULT
        // already put us here, and the global handler would clear streamText
        // mid-flight — unmounting the streamed bubble, so the list collapses to
        // the user message for a whole roundtrip (the finalize scroll-jump) —
        // and restart the in-flight fetchHistory, doubling that gap. The fetch
        // already running is authoritative: waitForTranscriptEntry
        // (core/chat/session/transcript-sync.ts) holds `result`/`done` until
        // the turn is durable, and onDone swaps messages in + clears streamText
        // atomically. See test/frontend/chat-machine-finalize.doctest.md.
        REFRESH: { actions: () => logFsm("refresh-ignored-refreshing") },
        SEND: {
          actions: [
            ({ event, context }) => logFsm("send-from-refreshing", {
              len: event.message.length,
              pending: context.pendingMessages.length,
            }),
            assign(appendQueuedSend),
            dispatchQueuedSend,
          ],
        },
      },
      invoke: {
        src: "fetchHistory",
        input: ({ context }) => ({ sessionInput: context.sessionInput }),
        onDone: {
          target: "idle",
          actions: assign(({ context, event }) => {
            // "new" session: server has no id yet, so fetchHistory returned
            // empty. Roll up whatever streamed for this turn into a synthetic
            // assistant entry so the completed response stays visible — the
            // chat-session-assigned SSE / URL navigation eventually loads
            // the authoritative copy and replaces this on remount.
            if (context.sessionInput === "new") {
              const synthetic = rollupStreamToEntry(context.streamText, context.streamTools);
              return {
                messages: synthetic ? [...context.messages, synthetic] : context.messages,
                streamText: "",
                streamTools: [],
              };
            }
            const reconciled = reconcilePending({
              serverMessages: event.output.entries,
              pendingMessages: context.pendingMessages,
            });
            return {
              messages: reconciled.messages,
              pendingMessages: reconciled.pendingMessages,
              sessionId: event.output.sessionId,
              totalEntries: event.output.total,
              processRunning: event.output.running,
              processBusy: event.output.busy,
              streamText: "",
              streamTools: [],
            };
          }),
        },
        onError: {
          target: "idle",
          actions: [
            ({ event }) => logFsm("refresh-error", {
              msg: event.error instanceof Error ? event.error.message : String(event.error),
            }),
            assign({
              streamText: "",
              streamTools: [],
            }),
          ],
        },
      },
    },
  },
});
