/**
 * XState machine for chat session lifecycle.
 *
 * States: loading → idle ⇄ streaming → refreshing → idle (`refreshCause`: how)
 *
 * The SSE stream lives in a callback actor's closure.
 * Serializable context holds messages, stream text, error, session info.
 * Voice turn-taking coordination stays in the component layer.
 */

import { setup, assign, enqueueActions } from "xstate";
import { invariant } from "@shared/invariant";
import { buildOptimisticContent, mergeAcceptedIntoPending } from "./chat-shared";
import { initialChatContext } from "./chat-machine-context";
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
  prependOlderMessages,
  promoteLastToPending,
  applyStreamError,
  untrackLastSend,
  clearInterrupt, markTurnRefresh, sendInterrupt,
  reconcilePendingWithDiagnostics,
} from "./chat-actions";

export { chatTailSlice };

// -- Machine --

export const chatMachine = setup({
  types: {
    context: {} as ChatContext,
    events: {} as ChatEvent,
    input: {} as ChatMachineInput,
  },
  actions: {
    // The queue-don't-interrupt SEND handling shared by `loading`,
    // `streaming`, and `refreshing`: the POST goes out now (the server
    // queues or dedups) and the receipt settles from the outcome; the
    // optimistic entry stays visible through `pendingMessages`
    // reconciliation. `loading` matters most: the iOS shell delivers
    // pending emissions on `didFinish`, before `fetchInitial` resolves,
    // and a swallowed SEND there meant no receipt and a shell redelivery
    // loop painting duplicate rows (the 2026-08-19 voice-duplicate
    // regression).
    queueSend: enqueueActions(({ enqueue, context, event }, params: { from: "loading" | "streaming" | "refreshing" }) => {
      invariant(event.type === "SEND", "queueSend only fires on SEND");
      logFsm(`send-from-${params.from}`, {
        len: event.message.length,
        pending: context.pendingMessages.length,
      });
      enqueue.assign(appendQueuedSend({ context, event }));
      dispatchQueuedSend({ context, event });
    }),
  },
  actors: {
    fetchInitial: fetchInitialActor,
    fetchHistory: fetchHistoryActor,
    stream: streamActor,
  },
}).createMachine({
  id: "chat",
  initial: "loading",
  context: ({ input }) => initialChatContext(input),
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
        assign({ streamText: "", streamTools: [], refreshCause: "resync" as const }),
      ],
    },
    // Global handler: another user sent a message (via SSE broadcast)
    OTHER_USER_MESSAGE: {
      actions: assign(appendOtherUserMessage),
    },
    // Global handler: prepend older messages loaded on demand (bounded — see
    // prependOlderMessages).
    PREPEND_MESSAGES: {
      actions: assign(prependOlderMessages),
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
      on: {
        SEND: { actions: { type: "queueSend", params: { from: "loading" } } },
        // Ignore REFRESH here (like streaming/refreshing): fetchInitial is in
        // flight and resolves fresher than any missed event, and honoring it
        // would cancel that fetch and skip its `initial`-clearing onDone.
        // Server-pushed history still lands via the global SET_MESSAGES.
        // (Reachable: the reconnect gate's trailing timer during a >5s load.)
        REFRESH: { actions: () => logFsm("refresh-ignored-loading") },
      },
      invoke: {
        src: "fetchInitial",
        input: ({ context }) => ({ sessionInput: context.sessionInput, initial: context.initial }),
        // `initial` is cleared on the way out either way, so nothing can
        // replay a stale preload if `loading` is ever re-entered.
        onDone: {
          target: "idle",
          // Reconcile rather than overwrite: a SEND that arrived during this
          // fetch appended a pending entry, and the fetched history predates
          // it — a plain overwrite would blank the row until the next refresh.
          actions: assign(({ context, event }) => {
            // The box's own record of what it accepted joins this machine's
            // optimistic copies before reconciliation. On a fresh page load
            // there are no optimistic copies — they died with the last page —
            // so these are the only thing standing between a reload mid-turn
            // and a conversation missing the question the box already has.
            // Reconciliation then retires whichever of them the transcript has
            // caught up to, exactly as it does for a locally-minted one.
            const carried = mergeAcceptedIntoPending({ pendingMessages: context.pendingMessages, accepted: event.output.pending });
            const { messages, pendingMessages } = reconcilePendingWithDiagnostics({ serverMessages: event.output.entries, pendingMessages: carried });
            return {
              messages, pendingMessages, sessionId: event.output.sessionId,
              processRunning: event.output.running, processBusy: event.output.busy,
              totalEntries: event.output.total, initial: undefined,
            };
          }),
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
            assign(({ context, event }) => {
              const entry = {
                uuid: event.messageId,
                type: "user" as const,
                timestamp: new Date().toISOString(),
                content: buildOptimisticContent(event.message, event.images),
                reconcileKnownUuids: context.messages.map((message) => message.uuid),
              };
              return {
                error: null,
                interrupting: false,
                streamText: "",
                streamTools: [],
                liveTurnId: event.messageId, // keys the live bubble across finalize
                messages: [...context.messages, entry],
                // SET_MESSAGES is global and can carry a server snapshot taken
                // before this send. Track the optimistic entry until history
                // echoes it so reconcilePending cannot erase it mid-turn.
                pendingMessages: [...context.pendingMessages, entry],
              };
            }),
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
            ...(context.sessionInput === "new" && context.startEngine !== undefined ? { engine: context.startEngine } : {}),
            ...(context.sessionInput === "new" && context.startModel !== undefined ? { model: context.startModel } : {}),
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
        // Clear `interrupting` though — the interrupt's own terminal paths do,
        // and a recovery during an interrupt must not leave the flag latched
        // into idle.
        STREAM_RECOVER: { target: "refreshing", actions: [assign(markTurnRefresh), assign(clearInterrupt)] },
        SEND: { actions: { type: "queueSend", params: { from: "streaming" } } },
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
          actions: [
            assign(untrackLastSend),
            assign({ error: "Agent is busy with another request" }),
          ],
        },
        STREAM_QUEUED: {
          target: "idle",
          // Backend was busy → this message is queued. Promote the active
          // optimistic user message to pending so reconcile keeps it visible
          // (dimmed) until the server has actually processed the queued turn.
          // It is already protected by reconcile; promotion adds the visible
          // queued state and enables the missed-chat-complete recovery poll.
          actions: assign(promoteLastToPending),
        },
        // A user interrupt ends the turn with is_error — suppress that
        // (clearInterrupt) and refresh for the partial; otherwise show it.
        STREAM_ERROR: [
          { guard: ({ context }) => context.interrupting, target: "refreshing", actions: [assign(markTurnRefresh), assign(clearInterrupt)] },
          { target: "idle", actions: assign(applyStreamError) },
        ],
        STREAM_RESULT: { target: "refreshing", actions: assign(markTurnRefresh) },
        STREAM_FAILED: [
          { guard: ({ context }) => context.interrupting, target: "refreshing", actions: [assign(markTurnRefresh), assign(clearInterrupt)] },
          // Go to refreshing instead of idle — the agent may still be
          // running on the server. Fetching history will pick up any
          // response that completed while we were disconnected.
          { target: "refreshing", actions: [assign(markTurnRefresh), assign(applyStreamError)] },
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
        SEND: { actions: { type: "queueSend", params: { from: "refreshing" } } },
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
            const reconciled = reconcilePendingWithDiagnostics({
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
