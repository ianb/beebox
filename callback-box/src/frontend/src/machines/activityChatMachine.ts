/**
 * XState machine for a per-activity chat session
 * (activityType / instanceName / modeName).
 *
 * Shape mirrors chatMachine: loading → idle ⇄ streaming → refreshing → idle,
 * idle → resetting → idle. The streaming model differs from regular chat —
 * `activities.send` returns immediately and the assistant output arrives via
 * the global event bus (`activity-chat-*` events). The owning component
 * subscribes to those events and forwards them to the machine as
 * STREAM_TEXT / STREAM_TOOL / STREAM_RESULT / STREAM_ERROR.
 */

import { setup, assign, fromPromise } from "xstate";
import { trpcClient } from "../lib/trpc";
import type { SessionEntry, SessionContentBlock } from "../api";
import { buildOptimisticContent, reconcilePending } from "./chat-shared";

export interface ActivityChatKey {
  type: string;
  instance: string;
  mode: string;
}

type ActivityChatEvent =
  | { type: "SEND"; message: string }
  | { type: "NEW_SESSION" }
  | { type: "DISMISS_ERROR" }
  | { type: "STREAM_TEXT"; text: string }
  | { type: "STREAM_TOOL"; tool: SessionContentBlock }
  | { type: "STREAM_RESULT" }
  | { type: "STREAM_ERROR"; error: string }
  | { type: "REFRESH" }
  | { type: "SET_MESSAGES"; messages: SessionEntry[]; sessionId: string | null };

interface ActivityChatContext {
  key: ActivityChatKey;
  messages: SessionEntry[];
  pendingMessages: SessionEntry[];
  streamText: string;
  streamTools: SessionContentBlock[];
  streamNeedsSeparator: boolean;
  error: string | null;
  sessionId: string | null;
  running: boolean;
  totalEntries: number;
}

const fetchInitialActor = fromPromise(
  async ({ input }: { input: ActivityChatKey }) => {
    const [history, status] = await Promise.all([
      trpcClient.activities.getHistory.query(input),
      trpcClient.activities.getStatus.query(input),
    ]);
    const sessionId = history.sessionId !== null ? history.sessionId : status.sessionId;
    return {
      entries: history.entries,
      total: history.total,
      sessionId,
      running: status.running,
    };
  },
);

const fetchHistoryActor = fromPromise(
  async ({ input }: { input: ActivityChatKey }) => {
    return trpcClient.activities.getHistory.query(input);
  },
);

const sendMessageActor = fromPromise(
  async ({ input }: { input: { key: ActivityChatKey; message: string } }) => {
    return trpcClient.activities.send.mutate({
      type: input.key.type,
      instance: input.key.instance,
      mode: input.key.mode,
      text: input.message,
    });
  },
);

const resetSessionActor = fromPromise(
  async ({ input }: { input: ActivityChatKey }) => {
    return trpcClient.activities.resetSession.mutate(input);
  },
);

export const activityChatMachine = setup({
  types: {
    context: {} as ActivityChatContext,
    events: {} as ActivityChatEvent,
    input: {} as ActivityChatKey,
  },
  actors: {
    fetchInitial: fetchInitialActor,
    fetchHistory: fetchHistoryActor,
    sendMessage: sendMessageActor,
    resetSession: resetSessionActor,
  },
}).createMachine({
  id: "activity-chat",
  initial: "loading",
  context: ({ input }) => ({
    key: input,
    messages: [],
    pendingMessages: [],
    streamText: "",
    streamTools: [],
    streamNeedsSeparator: false,
    error: null,
    sessionId: null,
    running: false,
    totalEntries: 0,
  }),
  on: {
    SET_MESSAGES: {
      actions: assign(({ context, event }) => {
        const reconciled = reconcilePending({
          serverMessages: event.messages,
          pendingMessages: context.pendingMessages,
        });
        return {
          messages: reconciled.messages,
          pendingMessages: reconciled.pendingMessages,
          sessionId: event.sessionId,
        };
      }),
    },
    REFRESH: {
      target: ".refreshing",
      actions: assign({ streamText: "", streamTools: [] }),
    },
  },
  states: {
    loading: {
      invoke: {
        src: "fetchInitial",
        input: ({ context }) => context.key,
        onDone: {
          target: "idle",
          actions: assign(({ event }) => ({
            messages: event.output.entries,
            sessionId: event.output.sessionId,
            running: event.output.running,
            totalEntries: event.output.total,
          })),
        },
        onError: {
          target: "idle",
          actions: assign(({ event }) => ({
            error: event.error instanceof Error ? event.error.message : "Failed to load",
          })),
        },
      },
    },
    idle: {
      on: {
        SEND: {
          target: "streaming",
          actions: assign(({ context, event }) => ({
            error: null,
            streamText: "",
            streamTools: [],
            messages: [
              ...context.messages,
              {
                uuid: `user-${Date.now()}`,
                type: "user" as const,
                timestamp: new Date().toISOString(),
                content: buildOptimisticContent(event.message),
              },
            ],
          })),
        },
        NEW_SESSION: "resetting",
        DISMISS_ERROR: { actions: assign({ error: null }) },
      },
    },
    streaming: {
      invoke: {
        src: "sendMessage",
        input: ({ context, event }) => {
          const sendEvent = event as Extract<ActivityChatEvent, { type: "SEND" }>;
          return { key: context.key, message: sendEvent.message };
        },
        onError: {
          target: "idle",
          actions: assign(({ event }) => ({
            error: event.error instanceof Error ? event.error.message : "Send failed",
            streamText: "",
            streamTools: [],
          })),
        },
      },
      on: {
        SEND: {
          actions: assign(({ context, event }) => {
            const entry: SessionEntry = {
              uuid: `user-${Date.now()}`,
              type: "user" as const,
              timestamp: new Date().toISOString(),
              content: buildOptimisticContent(event.message),
              pending: true,
            };
            // Fire-and-forget — let the backend enqueue.
            trpcClient.activities.send
              .mutate({
                type: context.key.type,
                instance: context.key.instance,
                mode: context.key.mode,
                text: event.message,
              })
              .catch(() => {});
            return {
              messages: [...context.messages, entry],
              pendingMessages: [...context.pendingMessages, entry],
            };
          }),
        },
        STREAM_TEXT: {
          actions: assign(({ context, event }) => ({
            streamText:
              context.streamNeedsSeparator && context.streamText
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
        STREAM_RESULT: "refreshing",
        STREAM_ERROR: {
          target: "idle",
          actions: assign(({ event }) => ({
            error: event.error,
            streamText: "",
            streamTools: [],
          })),
        },
      },
    },
    refreshing: {
      invoke: {
        src: "fetchHistory",
        input: ({ context }) => context.key,
        onDone: {
          target: "idle",
          actions: assign(({ context, event }) => {
            const reconciled = reconcilePending({
              serverMessages: event.output.entries,
              pendingMessages: context.pendingMessages,
            });
            return {
              messages: reconciled.messages,
              pendingMessages: reconciled.pendingMessages,
              sessionId: event.output.sessionId,
              totalEntries: event.output.total,
              streamText: "",
              streamTools: [],
            };
          }),
        },
        onError: {
          target: "idle",
          actions: assign({ streamText: "", streamTools: [] }),
        },
      },
      on: {
        SEND: {
          actions: assign(({ context, event }) => {
            const entry: SessionEntry = {
              uuid: `user-${Date.now()}`,
              type: "user" as const,
              timestamp: new Date().toISOString(),
              content: buildOptimisticContent(event.message),
              pending: true,
            };
            trpcClient.activities.send
              .mutate({
                type: context.key.type,
                instance: context.key.instance,
                mode: context.key.mode,
                text: event.message,
              })
              .catch(() => {});
            return {
              messages: [...context.messages, entry],
              pendingMessages: [...context.pendingMessages, entry],
            };
          }),
        },
      },
    },
    resetting: {
      invoke: {
        src: "resetSession",
        input: ({ context }) => context.key,
        onDone: {
          target: "idle",
          actions: assign({
            messages: [],
            pendingMessages: [],
            sessionId: null,
            running: false,
            error: null,
            totalEntries: 0,
          }),
        },
        onError: {
          target: "idle",
          actions: assign(({ event }) => ({
            error: event.error instanceof Error ? event.error.message : "Failed to reset",
          })),
        },
      },
    },
  },
});
