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
  type ChatImageAttachment,
} from "../api";
import { buildOptimisticContent, reconcilePending } from "./chat-shared";

/**
 * Forwarded to the server via the console-warn debug-log pipe so wedge
 * diagnostics survive across reloads. Kept terse and structured: a grep
 * for `[chatfsm]` in `.callback-box/client-debug.log` should reconstruct
 * the state timeline without needing the browser.
 */
function logFsm(event: string, detail?: Record<string, unknown>): void {
  const parts = [`[chatfsm] ${event}`];
  if (detail) {
    for (const [k, v] of Object.entries(detail)) {
      parts.push(`${k}=${typeof v === "string" ? v : JSON.stringify(v)}`);
    }
  }
  console.warn(parts.join(" "));
}

// -- Events --

type ChatEvent =
  | { type: "SEND"; message: string; images?: ChatImageAttachment[] }
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
  | { type: "OTHER_USER_MESSAGE"; message: string; userName: string; timestamp: string }
  | { type: "PREPEND_MESSAGES"; messages: SessionEntry[] };

// -- Context --

/** How many recent entries to load initially and on refresh. */
export const HISTORY_TAIL = 200;
/** Floor on how many real (typed/spoken) user messages the initial load must cover. */
export const MIN_REAL_USER_MESSAGES = 2;

interface ChatContext {
  messages: SessionEntry[];
  /** Messages sent while agent was busy — preserved across refreshes until server catches up. */
  pendingMessages: SessionEntry[];
  streamText: string;
  streamTools: SessionContentBlock[];
  /** True when tools ran since the last text — the next text block needs a paragraph separator. */
  streamNeedsSeparator: boolean;
  error: string | null;
  sessionId: string | null;
  processRunning: boolean;
  /** Total number of entries in the full session log. */
  totalEntries: number;
}

// -- Actors --

const fetchInitialActor = fromPromise(async () => {
  const [history, status] = await Promise.all([
    getChatHistory({ tail: HISTORY_TAIL, minRealUserMessages: MIN_REAL_USER_MESSAGES }),
    getChatStatus(),
  ]);
  return {
    entries: history.entries,
    total: history.total,
    sessionId: history.sessionId ?? status.sessionId,
    running: status.running,
  };
});

const fetchHistoryActor = fromPromise(async () => {
  return getChatHistory({ tail: HISTORY_TAIL, minRealUserMessages: MIN_REAL_USER_MESSAGES });
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
    input: { message: string; images?: ChatImageAttachment[] };
  }) => {
    // Track whether the stream ever produced a terminal event. If the SSE
    // ends cleanly without one (proxy timeout, server closed the socket
    // after the subprocess emitted `result` but before we parsed it, etc.),
    // the machine would otherwise sit in `streaming` forever.
    let terminalFired = false;
    let msgCount = 0;
    const terminal = (event: ChatEvent) => {
      terminalFired = true;
      logFsm("stream-terminal", { event: event.type, msgCount });
      sendBack(event);
    };

    logFsm("stream-start", {
      msgLen: input.message.length,
      images: input.images ? input.images.length : 0,
    });

    sendChatMessage({
      message: input.message,
      ...(input.images && input.images.length > 0 ? { images: input.images } : {}),
      onMessage: (msg) => {
        msgCount++;
        const type = msg.type as string;

        if (type === "busy") {
          terminal({ type: "STREAM_BUSY" });
          return;
        }

        if (type === "queued") {
          terminal({ type: "STREAM_QUEUED" });
          return;
        }

        if (type === "error") {
          terminal({
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
          terminal({ type: "STREAM_RESULT" });
        }
      },
    })
      .then(() => {
        if (!terminalFired) {
          logFsm("stream-eof-no-terminal", { msgCount });
          // Stream ended without any terminal event — fall back to a history
          // refresh so the UI can recover whatever the server completed.
          sendBack({
            type: "STREAM_FAILED",
            error: "Stream ended without result",
          });
        }
      })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : "Send failed";
        logFsm("stream-throw", { msg, msgCount });
        sendBack({
          type: "STREAM_FAILED",
          error: msg,
        });
      });

    return () => {};
  }
);

/**
 * Fire-and-forget: send a message to the backend knowing it will be queued.
 * We don't need to track the SSE response — the backend enqueues it and
 * the chat-complete SSE event will trigger a history refresh when the
 * queued turn finishes.
 */
function queueMessageToBackend(message: string, images?: ChatImageAttachment[]): void {
  sendChatMessage({
    message,
    ...(images && images.length > 0 ? { images } : {}),
    onMessage: () => {}, // ignore — will be "queued" then close
  }).catch(() => {}); // fire-and-forget
}

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
    pendingMessages: [],
    streamText: "",
    streamTools: [],
    streamNeedsSeparator: false,
    error: null,
    sessionId: null,
    processRunning: false,
    totalEntries: 0,
  },
  on: {
    // Global handler: directly set messages from any state (used by server-push updates)
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
    // Global handler: refresh history from any state (e.g., after SSE chat-complete)
    REFRESH: {
      target: ".refreshing",
      actions: [
        ({ context }) => logFsm("refresh", {
          pending: context.pendingMessages.length,
          msgs: context.messages.length,
        }),
        assign({
          streamText: "",
          streamTools: [],
        }),
      ],
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
    // Global handler: prepend older messages loaded on demand
    PREPEND_MESSAGES: {
      actions: assign(({ context, event }) => ({
        messages: [...event.messages, ...context.messages],
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
            totalEntries: event.output.total,
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
              streamText: "",
              streamTools: [],
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
        NEW_SESSION: "resetting",
        DISMISS_ERROR: {
          actions: assign({ error: null }),
        },
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
        input: ({ event }) => {
          const sendEvent = event as Extract<ChatEvent, { type: "SEND" }>;
          return {
            message: sendEvent.message,
            ...(sendEvent.images && sendEvent.images.length > 0
              ? { images: sendEvent.images }
              : {}),
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
        SEND: {
          // Queue the message — don't interrupt the current stream
          actions: [
            ({ event, context }) => logFsm("send-from-streaming", {
              len: event.message.length,
              pending: context.pendingMessages.length,
            }),
            assign(({ context, event }) => {
              const entry: SessionEntry = {
                uuid: `user-${Date.now()}`,
                type: "user" as const,
                timestamp: new Date().toISOString(),
                content: buildOptimisticContent(event.message, event.images),
                pending: true,
              };
              return {
                messages: [...context.messages, entry],
                pendingMessages: [...context.pendingMessages, entry],
              };
            }),
            ({ event }) => queueMessageToBackend(event.message, event.images),
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
          actions: assign(({ context }) => {
            const last = context.messages[context.messages.length - 1];
            if (!last || last.type !== "user") return {};
            if (context.pendingMessages.some((p) => p.uuid === last.uuid)) return {};
            const promoted: SessionEntry = { ...last, pending: true };
            return {
              messages: [...context.messages.slice(0, -1), promoted],
              pendingMessages: [...context.pendingMessages, promoted],
            };
          }),
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
          // Go to refreshing instead of idle — the agent may still be
          // running on the server. Fetching history will pick up any
          // response that completed while we were disconnected.
          target: "refreshing",
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
      entry: ({ context }) => logFsm("enter-refreshing", {
        pending: context.pendingMessages.length,
      }),
      on: {
        SEND: {
          actions: [
            ({ event, context }) => logFsm("send-from-refreshing", {
              len: event.message.length,
              pending: context.pendingMessages.length,
            }),
            assign(({ context, event }) => {
              const entry: SessionEntry = {
                uuid: `user-${Date.now()}`,
                type: "user" as const,
                timestamp: new Date().toISOString(),
                content: buildOptimisticContent(event.message, event.images),
                pending: true,
              };
              return {
                messages: [...context.messages, entry],
                pendingMessages: [...context.pendingMessages, entry],
              };
            }),
            ({ event }) => queueMessageToBackend(event.message, event.images),
          ],
        },
      },
      invoke: {
        src: "fetchHistory",
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
    resetting: {
      invoke: {
        src: "resetSession",
        onDone: {
          target: "idle",
          actions: assign({
            messages: [],
            pendingMessages: [],
            sessionId: null,
            processRunning: false,
            error: null,
            totalEntries: 0,
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
