/**
 * XState actors (and their internal helpers) for the chat machine.
 *
 * `fetchInitialActor` / `fetchHistoryActor` load session history + status;
 * `streamActor` runs the SSE turn in a callback closure. Kept separate from
 * the machine wiring in `chatMachine.ts` to keep both files under the
 * line budget. `rollupStreamToEntry` is consumed by the machine's
 * refreshing-onDone action and is therefore exported.
 */

import { fromCallback, fromPromise } from "xstate";
import {
  getChatHistory,
  getChatStatus,
  sendChatMessage,
  type SessionEntry,
  type SessionContentBlock,
  type ChatImageAttachment,
} from "../api";
import {
  HISTORY_TAIL,
  MIN_REAL_USER_MESSAGES,
  logFsm,
  type ChatEvent,
  type SessionInput,
} from "./chat-types";

export const fetchInitialActor = fromPromise<
  { entries: SessionEntry[]; total: number; sessionId: string | null; running: boolean; busy: boolean },
  SessionInput
>(async ({ input }) => {
  if (input.sessionInput === "new") {
    return { entries: [], total: 0, sessionId: null, running: false, busy: false };
  }
  const [history, status] = await Promise.all([
    getChatHistory({ sessionId: input.sessionInput, tail: HISTORY_TAIL, minRealUserMessages: MIN_REAL_USER_MESSAGES }),
    getChatStatus({ sessionId: input.sessionInput }),
  ]);
  return {
    entries: history.entries,
    total: history.total,
    sessionId: history.sessionId ?? status.sessionId,
    running: status.running,
    busy: status.busy,
  };
});

export const fetchHistoryActor = fromPromise<
  { sessionId: string | null; entries: SessionEntry[]; total: number; running: boolean; busy: boolean },
  SessionInput
>(async ({ input }) => {
  if (input.sessionInput === "new") {
    return { sessionId: null, entries: [], total: 0, running: false, busy: false };
  }
  const [history, status] = await Promise.all([
    getChatHistory({ sessionId: input.sessionInput, tail: HISTORY_TAIL, minRealUserMessages: MIN_REAL_USER_MESSAGES }),
    getChatStatus({ sessionId: input.sessionInput }),
  ]);
  return {
    sessionId: history.sessionId ?? status.sessionId,
    entries: history.entries,
    total: history.total,
    running: status.running,
    busy: status.busy,
  };
});

/**
 * The SDK's `system/init` message is the first frame of every stream and
 * carries the session id this turn is running under (possibly different from
 * what we sent — the SDK rotates on resume in some paths). Forward it onto
 * the machine immediately so the URL update / id pinning doesn't have to wait
 * for the side-channel `chat-session-assigned` event on /events, which can be
 * lost across a backend restart and leave the frontend stuck on `session=new`.
 */
function handleSystemInit(
  msg: { subtype?: string; session_id?: string },
  ctx: { sessionInput: string; sendBack: (event: ChatEvent) => void },
): void {
  if (msg.subtype !== "init") return;
  const assigned = msg.session_id;
  if (!assigned || assigned === ctx.sessionInput) return;
  ctx.sendBack({ type: "SESSION_ASSIGNED", sessionId: assigned });
}

/**
 * Dev-only stream stub. When a user message begins with `/fakestream`, the
 * machine plays a timed script of STREAM_TEXT events instead of hitting the
 * backend. Used to reproduce streaming-UI bugs (scroll, layout) deterministically.
 *
 * Syntax: `/fakestream [chunks] [intervalMs] [chunkLen]`
 *   chunks     — total STREAM_TEXT events to emit (default 200)
 *   intervalMs — delay between events (default 40)
 *   chunkLen   — approx chars per chunk (default 25)
 *
 * Emits a STREAM_TOOL event partway through so the live tool-list layout
 * (e.g. ordering relative to the throbber) is exercised too.
 */
function runFakeStream(
  message: string,
  { sendBack, terminal }: {
    sendBack: (event: ChatEvent) => void;
    terminal: (event: ChatEvent) => void;
  },
): () => void {
  const parts = message.trim().split(/\s+/);
  const chunks = Number.parseInt(parts[1], 10) || 200;
  const intervalMs = Number.parseInt(parts[2], 10) || 40;
  const chunkLen = Number.parseInt(parts[3], 10) || 25;
  const toolAt = Math.floor(chunks / 3);

  const para = "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum. ";
  let body = "# Fakestream\n\n";
  for (let i = 0; i < 12; i++) body += para + "\n\n";

  let pos = 0;
  let emitted = 0;
  const handle = window.setInterval(() => {
    if (emitted >= chunks) {
      window.clearInterval(handle);
      terminal({ type: "STREAM_RESULT" });
      return;
    }
    if (emitted === toolAt) {
      sendBack({
        type: "STREAM_TOOL",
        tool: {
          type: "tool_use",
          toolName: "Read",
          toolId: "fakestream-tool-1",
          input: { file_path: "/tmp/fakestream.txt" },
          inputSummary: "Read",
        },
      });
    }
    const next = body.slice(pos, pos + chunkLen);
    pos = (pos + chunkLen) % body.length;
    sendBack({ type: "STREAM_TEXT", text: next });
    emitted++;
  }, intervalMs);

  return () => window.clearInterval(handle);
}

export const streamActor = fromCallback(
  ({
    sendBack,
    input,
  }: {
    sendBack: (event: ChatEvent) => void;
    input: { sessionInput: string; message: string; messageId: string; images?: ChatImageAttachment[]; contextDir?: string; seedFeatures?: Record<string, string> };
  }) => {
    // Track whether the stream ever produced a terminal event. If the SSE
    // ends cleanly without one (proxy timeout, server closed the socket
    // after the subprocess emitted `result` but before we parsed it, etc.),
    // the machine would otherwise sit in `streaming` forever.
    let terminalFired = false;
    let msgCount = 0;
    // When the backend has `includePartialMessages` on, text deltas arrive
    // before the final `assistant` message. We accumulate them via
    // STREAM_TEXT events; the final assistant message would re-deliver the
    // same text, so we suppress its text blocks (tool_use blocks still
    // come through, as those don't stream as deltas the same way).
    let sawTextPartial = false;
    const terminal = (event: ChatEvent) => {
      terminalFired = true;
      logFsm("stream-terminal", { event: event.type, msgCount });
      sendBack(event);
    };

    logFsm("stream-start", {
      msgLen: input.message.length,
      images: input.images ? input.images.length : 0,
    });

    const unwrapped = input.message.replace(/^<typed[^>]*>/, "").replace(/<\/typed>$/, "");
    if (unwrapped.startsWith("/fakestream")) {
      return runFakeStream(unwrapped, { sendBack, terminal });
    }

    sendChatMessage({
      session: input.sessionInput,
      message: input.message,
      messageId: input.messageId,
      ...(input.images && input.images.length > 0 ? { images: input.images } : {}),
      ...(input.contextDir ? { contextDir: input.contextDir } : {}),
      ...(input.seedFeatures ? { seedFeatures: input.seedFeatures } : {}),
      onMessage: (msg) => {
        msgCount++;
        const type = msg.type as string;

        if (type === "system") {
          handleSystemInit(msg, { sessionInput: input.sessionInput, sendBack });
          return;
        }

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

        if (type === "stream_event") {
          // Anthropic raw streaming events. We surface text_delta for live
          // text rendering and the speech-tag accumulator. Other event
          // shapes (input_json_delta for tool_use, message_start/stop,
          // ping, etc.) are ignored — the final assistant message still
          // delivers tool_use blocks atomically.
          const event = (msg as { event?: { type?: string; delta?: { type?: string; text?: string } } }).event;
          if (
            event !== undefined &&
            event.type === "content_block_delta" &&
            event.delta !== undefined &&
            event.delta.type === "text_delta" &&
            typeof event.delta.text === "string" &&
            event.delta.text.length > 0
          ) {
            sawTextPartial = true;
            sendBack({ type: "STREAM_TEXT", text: event.delta.text });
          }
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
                // If we already accumulated this text via stream_event
                // deltas, skip it — otherwise we'd double-append.
                if (sawTextPartial) continue;
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
          // The SDK signals turn-level failures (e.g. asked to resume a
          // session id with no log on disk) by setting is_error on an
          // otherwise empty result. Treat those as stream errors so the
          // UI shows a message instead of silently going idle while the
          // optimistic bubble sits stranded.
          const isError = (msg as { is_error?: boolean }).is_error === true;
          if (isError) {
            const subtype = (msg as { subtype?: string }).subtype ?? "unknown";
            terminal({
              type: "STREAM_ERROR",
              error: `Agent turn failed (${subtype}). The session id in this tab's URL has no log on disk — start a new chat.`,
            });
          } else {
            terminal({ type: "STREAM_RESULT" });
          }
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
 * Build a synthetic assistant entry from the in-memory stream buffers so a
 * completed turn stays visible when we can't refetch from the server (the
 * "new" session case — the backend hasn't surfaced a session id yet, so
 * `getChatHistory` has nothing to return).
 */
export function rollupStreamToEntry(
  streamText: string,
  streamTools: SessionContentBlock[],
): SessionEntry | null {
  if (!streamText && streamTools.length === 0) return null;
  const content: SessionContentBlock[] = [...streamTools];
  if (streamText) content.push({ type: "text", text: streamText });
  return {
    uuid: `assistant-stream-${Date.now()}`,
    type: "assistant",
    timestamp: new Date().toISOString(),
    content,
  };
}

/**
 * Fire-and-forget: send a message to the backend knowing it will be queued.
 * We don't need to track the SSE response — the backend enqueues it and
 * the chat-complete SSE event will trigger a history refresh when the
 * queued turn finishes.
 */
export function queueMessageToBackend(opts: { session: string; message: string; messageId: string; images?: ChatImageAttachment[] }): void {
  const { session, message, messageId, images } = opts;
  sendChatMessage({
    session,
    message,
    messageId,
    ...(images && images.length > 0 ? { images } : {}),
    onMessage: () => {}, // ignore — will be "queued" then close
  }).catch(() => {}); // fire-and-forget
}
