/**
 * XState machine for chat session lifecycle.
 *
 * States: loading → idle ⇄ streaming → refreshing → idle
 *                   idle → resetting → idle
 *
 * The SSE stream lives in a callback actor's closure.
 * Serializable context holds messages, stream text, error, session info.
 * Voice turn-taking coordination stays in the component layer.
 */

import { setup, assign, fromCallback, fromPromise } from "xstate";
import {
  getChatHistory,
  getChatStatus,
  sendChatMessage,
  interruptChat,
  resetChatSession,
  type SessionEntry,
  type SessionContentBlock,
} from "../api";

// -- Events --

type ChatEvent =
  | { type: "SEND"; message: string }
  | { type: "NEW_SESSION" }
  | { type: "INTERRUPT" }
  | { type: "DISMISS_ERROR" }
  | { type: "STREAM_TEXT"; text: string }
  | { type: "STREAM_TOOL"; tool: SessionContentBlock }
  | { type: "STREAM_BUSY" }
  | { type: "STREAM_QUEUED" }
  | { type: "STREAM_ERROR"; error: string }
  | { type: "STREAM_RESULT" }
  | { type: "STREAM_FAILED"; error: string }
  | { type: "REFRESH" }
  | { type: "SET_MESSAGES"; messages: SessionEntry[]; sessionId: string | null }
  | { type: "OTHER_USER_MESSAGE"; message: string; userName: string; timestamp: string };

// -- Context --

interface ChatContext {
  messages: SessionEntry[];
  streamText: string;
  streamTools: SessionContentBlock[];
  error: string | null;
  sessionId: string | null;
  processRunning: boolean;
}

// -- Actors --

const fetchInitialActor = fromPromise(async () => {
  const [history, status] = await Promise.all([
    getChatHistory(),
    getChatStatus(),
  ]);
  return {
    entries: history.entries,
    sessionId: history.sessionId ?? status.sessionId,
    running: status.running,
  };
});

const fetchHistoryActor = fromPromise(async () => {
  return getChatHistory();
});

const resetSessionActor = fromPromise(async () => {
  return resetChatSession();
});

const streamActor = fromCallback(
  ({
    sendBack,
    input,
  }: {
    sendBack: (event: ChatEvent) => void;
    input: { message: string };
  }) => {
    sendChatMessage({
      message: input.message,
      onMessage: (msg) => {
        const type = msg.type as string;

        if (type === "busy") {
          sendBack({ type: "STREAM_BUSY" });
          return;
        }

        if (type === "queued") {
          sendBack({ type: "STREAM_QUEUED" });
          return;
        }

        if (type === "error") {
          sendBack({
            type: "STREAM_ERROR",
            error: (msg.error as string) || "Unknown error",
          });
          return;
        }

        if (type === "assistant") {
          const message = msg.message as
            | {
                content?: Array<{
                  type: string;
                  text?: string;
                  name?: string;
                  id?: string;
                  input?: Record<string, unknown>;
                }>;
              }
            | undefined;
          if (message?.content) {
            for (const block of message.content) {
              if (block.type === "text" && block.text) {
                sendBack({ type: "STREAM_TEXT", text: block.text });
              } else if (block.type === "tool_use") {
                sendBack({
                  type: "STREAM_TOOL",
                  tool: {
                    type: "tool_use",
                    toolName: block.name,
                    toolId: block.id,
                    input: block.input,
                    inputSummary: block.name ?? "",
                  },
                });
              }
            }
          }
        }

        if (type === "result") {
          sendBack({ type: "STREAM_RESULT" });
        }
      },
    }).catch((err) => {
      sendBack({
        type: "STREAM_FAILED",
        error: err instanceof Error ? err.message : "Send failed",
      });
    });

    return () => {};
  }
);

// -- Machine --

export const chatMachine = setup({
  types: {
    context: {} as ChatContext,
    events: {} as ChatEvent,
  },
  actors: {
    fetchInitial: fetchInitialActor,
    fetchHistory: fetchHistoryActor,
    resetSession: resetSessionActor,
    stream: streamActor,
  },
}).createMachine({
  id: "chat",
  initial: "loading",
  context: {
    messages: [],
    streamText: "",
    streamTools: [],
    error: null,
    sessionId: null,
    processRunning: false,
  },
  on: {
    // Global handler: directly set messages from any state (used by server-push updates)
    SET_MESSAGES: {
      actions: assign(({ event }) => ({
        messages: event.messages,
        sessionId: event.sessionId,
      })),
    },
    // Global handler: another user sent a message (via SSE broadcast)
    OTHER_USER_MESSAGE: {
      actions: assign(({ context, event }) => ({
        messages: [
          ...context.messages,
          {
            uuid: `other-${Date.now()}`,
            type: "user" as const,
            timestamp: event.timestamp,
            content: [{ type: "text" as const, text: event.message }],
            user: event.userName,
          },
        ],
      })),
    },
  },
  states: {
    loading: {
      invoke: {
        src: "fetchInitial",
        onDone: {
          target: "idle",
          actions: assign(({ event }) => ({
            messages: event.output.entries,
            sessionId: event.output.sessionId,
            processRunning: event.output.running,
          })),
        },
        onError: {
          target: "idle",
          actions: assign(({ event }) => ({
            error:
              event.error instanceof Error
                ? event.error.message
                : "Failed to load",
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
                content: [{ type: "text" as const, text: event.message }],
              },
            ],
          })),
        },
        NEW_SESSION: "resetting",
        REFRESH: "refreshing",
        DISMISS_ERROR: {
          actions: assign({ error: null }),
        },
      },
    },
    streaming: {
      invoke: {
        id: "chatStream",
        src: "stream",
        input: ({ event }) => ({
          message: (event as Extract<ChatEvent, { type: "SEND" }>).message,
        }),
      },
      on: {
        STREAM_TEXT: {
          actions: assign(({ context, event }) => ({
            streamText: context.streamText + event.text,
          })),
        },
        STREAM_TOOL: {
          actions: assign(({ context, event }) => ({
            streamTools: [...context.streamTools, event.tool],
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
          // Message was queued — no error, it'll be sent when the current turn finishes
        },
        STREAM_ERROR: {
          target: "idle",
          actions: assign(({ event }) => ({
            error: event.error,
            streamText: "",
            streamTools: [],
          })),
        },
        STREAM_RESULT: "refreshing",
        STREAM_FAILED: {
          target: "idle",
          actions: assign(({ event }) => ({
            error: event.error,
            streamText: "",
            streamTools: [],
          })),
        },
        INTERRUPT: {
          actions: () => {
            interruptChat().catch(() => {});
          },
        },
      },
    },
    refreshing: {
      invoke: {
        src: "fetchHistory",
        onDone: {
          target: "idle",
          actions: assign(({ event }) => ({
            messages: event.output.entries,
            sessionId: event.output.sessionId,
            streamText: "",
            streamTools: [],
          })),
        },
        onError: {
          target: "idle",
          actions: assign({
            streamText: "",
            streamTools: [],
          }),
        },
      },
    },
    resetting: {
      invoke: {
        src: "resetSession",
        onDone: {
          target: "idle",
          actions: assign({
            messages: [],
            sessionId: null,
            processRunning: false,
            error: null,
          }),
        },
        onError: {
          target: "idle",
          actions: assign(({ event }) => ({
            error:
              event.error instanceof Error
                ? event.error.message
                : "Failed to reset session",
          })),
        },
      },
    },
  },
});
