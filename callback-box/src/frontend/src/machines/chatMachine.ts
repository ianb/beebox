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
const HISTORY_TAIL = 200;
/** Floor on how many real (typed/spoken) user messages the initial load must cover. */
const MIN_REAL_USER_MESSAGES = 2;

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
    const terminal = (event: ChatEvent) => {
      terminalFired = true;
      sendBack(event);
    };

    sendChatMessage({
      message: input.message,
      ...(input.images && input.images.length > 0 ? { images: input.images } : {}),
      onMessage: (msg) => {
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
          // Stream ended without any terminal event — fall back to a history
          // refresh so the UI can recover whatever the server completed.
          sendBack({
            type: "STREAM_FAILED",
            error: "Stream ended without result",
          });
        }
      })
      .catch((err) => {
        sendBack({
          type: "STREAM_FAILED",
          error: err instanceof Error ? err.message : "Send failed",
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

/**
 * Build content blocks for the optimistic user message bubble displayed
 * before the server responds. Mirrors the server-side `buildContentBlocks`
 * in chat-session.ts so the local preview matches what gets stored in the
 * session log — `[imageN]` tokens become inline image blocks.
 */
function buildOptimisticContent(
  message: string,
  images?: ChatImageAttachment[]
): SessionContentBlock[] {
  const attached = images ?? [];
  if (attached.length === 0) {
    return [{ type: "text", text: message }];
  }

  const byId = new Map<number, ChatImageAttachment>();
  for (const img of attached) byId.set(img.id, img);
  const used = new Set<number>();

  const blocks: SessionContentBlock[] = [];
  const tokenRe = /\[image(\d+)]/g;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = tokenRe.exec(message)) !== null) {
    const idStr = match[1];
    if (!idStr) continue;
    const id = parseInt(idStr, 10);
    const img = byId.get(id);
    if (!img) continue;
    if (match.index > cursor) {
      blocks.push({ type: "text", text: message.slice(cursor, match.index) });
    }
    blocks.push({
      type: "image",
      mediaType: img.mimeType,
      dataBase64: img.dataBase64,
    });
    used.add(id);
    cursor = match.index + match[0].length;
  }
  if (cursor < message.length) {
    blocks.push({ type: "text", text: message.slice(cursor) });
  }
  for (const img of attached) {
    if (used.has(img.id)) continue;
    blocks.push({
      type: "image",
      mediaType: img.mimeType,
      dataBase64: img.dataBase64,
    });
  }
  return blocks;
}

/** Extract the text content from a session entry. */
function entryText(entry: SessionEntry): string {
  return entry.content
    .filter((b): b is { type: "text"; text: string } => b.type === "text")
    .map((b) => b.text)
    .join("");
}

/**
 * After fetching server history, filter out pending messages that the server
 * has caught up to, then append remaining pending messages so they stay visible.
 *
 * The backend's drainQueue() combines multiple queued messages into one turn
 * (joined with \n\n), so we use substring matching: a pending message is
 * considered delivered if its text appears as a substring of any recent
 * server user message.
 */
function reconcilePending(params: {
  serverMessages: SessionEntry[];
  pendingMessages: SessionEntry[];
}): { messages: SessionEntry[]; pendingMessages: SessionEntry[] } {
  const { serverMessages, pendingMessages } = params;
  if (pendingMessages.length === 0) {
    return { messages: serverMessages, pendingMessages: [] };
  }

  // Collect text from recent server user messages for substring matching
  const serverUserTexts: string[] = [];
  for (let i = serverMessages.length - 1; i >= 0 && serverUserTexts.length < pendingMessages.length + 5; i--) {
    const entry = serverMessages[i];
    if (entry && entry.type === "user") {
      serverUserTexts.push(entryText(entry));
    }
  }

  // A pending message is delivered if its text is an exact match OR a
  // substring of any recent server user message (handles combined messages)
  const stillPending = pendingMessages.filter((pm) => {
    const pmText = entryText(pm);
    return !serverUserTexts.some((st) => st === pmText || st.includes(pmText));
  });

  return {
    messages: [...serverMessages, ...stillPending],
    pendingMessages: stillPending,
  };
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
      actions: assign({
        streamText: "",
        streamTools: [],
      }),
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
                content: buildOptimisticContent(event.message, event.images),
              },
            ],
          })),
        },
        NEW_SESSION: "resetting",
        DISMISS_ERROR: {
          actions: assign({ error: null }),
        },
      },
    },
    streaming: {
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
        REFRESH: {},
        SEND: {
          // Queue the message — don't interrupt the current stream
          actions: [
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
      on: {
        SEND: {
          actions: [
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
