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
  startChatTurn,
  type SessionEntry,
  type SessionContentBlock,
  type ChatImageAttachment,
} from "../api";
import { trpcClient } from "../lib/trpc";
import { buildStreamEntry } from "../lib/stream-entry";
import type { ChatMessage } from "../../../core/chat-session-messages.js";
import type { ActivityKind, CardStateDetails } from "../../../core/chat-card-activity";
import { HISTORY_TAIL, MIN_REAL_USER_MESSAGES, logFsm, type ChatEvent, type SessionInput } from "./chat-types";

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

/**
 * Map one agent message frame onto the chat machine's STREAM_* events. Control
 * outcomes (queued / deduplicated / send error) no longer arrive here — they're
 * the JSON result of startChatTurn — so this only handles real agent messages:
 * the session-id init, live text deltas, the final assistant blocks, and the
 * terminal result.
 */
export function handleTurnMessage(
  msg: ChatMessage,
  ctx: {
    sessionInput: string;
    sendBack: (event: ChatEvent) => void;
    terminal: (event: ChatEvent) => void;
    state: { sawTextPartial: boolean };
  },
): void {
  const { sessionInput, sendBack, terminal, state } = ctx;

  if (msg.type === "system") {
    handleSystemInit(msg, { sessionInput, sendBack });
    return;
  }

  if (msg.type === "stream_event") {
    // Anthropic raw streaming events. Surface text_delta for live text + the
    // speech-tag accumulator; other shapes (input_json_delta, message_start/
    // stop, ping) are ignored — the final assistant message delivers tool_use
    // blocks atomically.
    const event = msg.event as { type?: string; delta?: { type?: string; text?: string } } | undefined;
    if (
      event !== undefined &&
      event.type === "content_block_delta" &&
      event.delta !== undefined &&
      event.delta.type === "text_delta" &&
      typeof event.delta.text === "string" &&
      event.delta.text.length > 0
    ) {
      state.sawTextPartial = true;
      sendBack({ type: "STREAM_TEXT", text: event.delta.text });
    }
    return;
  }

  if (msg.type === "assistant") {
    const content = msg.message?.content;
    if (content) {
      for (const block of content) {
        if (block.type === "text" && block.text) {
          // Skip text already accumulated via stream_event deltas. `sawTextPartial`
          // is scoped to the CURRENT block (reset below): the SDK emits one
          // assistant message per content block, and a streamed block's deltas
          // always arrive immediately before that block's own assistant frame. So
          // the latch is true here only when *this* block streamed — an atomic
          // block (post-tool text/embeds delivered with no deltas) finds it false
          // and is surfaced. A turn-global latch dropped every atomic block after
          // the first streamed one (the "only the last block renders" bug).
          if (state.sawTextPartial) continue;
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
    // One block per assistant frame: clear the latch so the next block's deltas
    // (if any) re-arm it, and an atomic next block isn't mistaken for a duplicate.
    state.sawTextPartial = false;
    return;
  }

  if (msg.type === "result") {
    // A result with is_error=true means the turn errored even though the run
    // "completed" (subtype is often "success"). Surface the SDK's own error
    // text when present rather than guessing a cause — the previous hardcoded
    // "no log on disk" message was wrong for the common case where the
    // selected model is unavailable (it fails in ~500ms with is_error=true,
    // subtype=success). Real causes vary: unavailable model, unresumable
    // session, server error.
    if (msg.is_error === true) {
      const detail = typeof msg.result === "string" && msg.result.trim()
        ? msg.result.trim()
        : `the run reported an error with no detail (subtype: ${msg.subtype ?? "unknown"}). Common causes: the selected model is unavailable, or this session can't be resumed.`;
      terminal({ type: "STREAM_ERROR", error: `Chat turn failed — ${detail}` });
    } else {
      terminal({ type: "STREAM_RESULT" });
    }
  }
}

/** A frame yielded by events.turnStream, possibly still inside a tracked envelope. */
type TurnStreamWire =
  | { t: "msg"; msg: ChatMessage }
  | { t: "resync" }
  | { t: "error"; error: string }
  | { id: string; data: { t: "msg"; msg: ChatMessage } };

function unwrapTurnFrame(wire: TurnStreamWire): { t: "msg"; msg: ChatMessage } | { t: "resync" } | { t: "error"; error: string } {
  return "t" in wire ? wire : wire.data;
}

export const streamActor = fromCallback(
  ({
    sendBack,
    input,
  }: {
    sendBack: (event: ChatEvent) => void;
    input: { sessionInput: string; message: string; messageId: string; images?: ChatImageAttachment[]; contextDir?: string; seedFeatures?: Record<string, string>; openCard?: string; cardActivity?: ActivityKind[]; cardState?: CardStateDetails };
  }) => {
    let terminalFired = false;
    let msgCount = 0;
    // includePartialMessages delivers text deltas before the final assistant
    // message; we accumulate those and suppress the assistant's duplicate text.
    const state = { sawTextPartial: false };
    const terminal = (event: ChatEvent): void => {
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

    let cancelled = false;
    let unsubscribe: (() => void) | null = null;

    startChatTurn({
      session: input.sessionInput,
      message: input.message,
      messageId: input.messageId,
      ...(input.images && input.images.length > 0 ? { images: input.images } : {}),
      ...(input.contextDir ? { contextDir: input.contextDir } : {}),
      ...(input.seedFeatures ? { seedFeatures: input.seedFeatures } : {}),
      ...(input.openCard !== undefined ? { openCard: input.openCard } : {}),
      ...(input.cardActivity && input.cardActivity.length > 0 ? { cardActivity: input.cardActivity } : {}),
      ...(input.cardState && Object.keys(input.cardState).length > 0 ? { cardState: input.cardState } : {}),
    })
      .then((result) => {
        if (cancelled) return;
        // Queued / deduplicated finish the turn without a stream — the chat
        // machine refreshes history from these terminal states.
        if (result.deduplicated) {
          terminal({ type: "STREAM_RESULT" });
          return;
        }
        if (result.queued) {
          terminal({ type: "STREAM_QUEUED" });
          return;
        }
        if (!result.turnId) {
          terminal({ type: "STREAM_FAILED", error: "Send returned no turn id" });
          return;
        }

        // Subscribe to the turn's output. wsLink resumes this automatically on a
        // dropped connection (lastEventId = last seq), so partial text survives.
        const sub = trpcClient.events.turnStream.subscribe(
          { turnId: result.turnId },
          {
            onData: (data: TurnStreamWire) => {
              msgCount++;
              const frame = unwrapTurnFrame(data);
              if (frame.t === "resync") {
                // Buffer gone / reconnect past evicted frames → silent recover
                // to a history refresh (the durable transcript floor).
                terminal({ type: "STREAM_RECOVER" });
                return;
              }
              if (frame.t === "error") {
                // console.error (not logFsm/debug) so it forwards to the
                // box's client-debug.log — this path once surfaced a tRPC
                // protocol error in the banner with no trace in any log.
                console.error(`[chat] turn stream error frame: ${frame.error}`);
                terminal({ type: "STREAM_FAILED", error: frame.error });
                return;
              }
              handleTurnMessage(frame.msg, { sessionInput: input.sessionInput, sendBack, terminal, state });
            },
            onError: (err: { message: string }) => {
              console.error(`[chat] turn stream subscription failed: ${err.message}`);
              logFsm("stream-throw", { msg: err.message, msgCount });
              if (!terminalFired) sendBack({ type: "STREAM_FAILED", error: err.message });
            },
            onComplete: () => {
              // The subscription ended without a terminal (turn closed without a
              // result frame) — fall back to a history refresh.
              if (!terminalFired) {
                logFsm("stream-eof-no-terminal", { msgCount });
                sendBack({ type: "STREAM_FAILED", error: "Stream ended without result" });
              }
            },
          },
        );
        unsubscribe = () => sub.unsubscribe();
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : "Send failed";
        console.error(`[chat] send failed: ${msg}`);
        logFsm("stream-throw", { msg, msgCount });
        sendBack({ type: "STREAM_FAILED", error: msg });
      });

    return () => {
      cancelled = true;
      if (unsubscribe) unsubscribe();
    };
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
  return buildStreamEntry({ uuid: `assistant-stream-${Date.now()}`, streamText, streamTools });
}

/**
 * Fire-and-forget: send a message to the backend knowing it will be queued.
 * We don't track the outcome — the backend enqueues it and the chat-complete
 * event triggers a history refresh when the queued turn finishes.
 */
export function queueMessageToBackend(opts: { session: string; message: string; messageId: string; images?: ChatImageAttachment[]; openCard?: string; cardActivity?: ActivityKind[]; cardState?: CardStateDetails }): void {
  const { session, message, messageId, images, openCard, cardActivity, cardState } = opts;
  startChatTurn({
    session,
    message,
    messageId,
    ...(images && images.length > 0 ? { images } : {}),
    ...(openCard !== undefined ? { openCard } : {}),
    ...(cardActivity && cardActivity.length > 0 ? { cardActivity } : {}),
    ...(cardState && Object.keys(cardState).length > 0 ? { cardState } : {}),
  }).catch(() => {}); // fire-and-forget
}
