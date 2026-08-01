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
import type { ChatTurnStart } from "../api-chat";
import { trpcClient } from "../lib/trpc";
// Raw relative (not `@shared/…`): loaded outside Vite by the tap/tsx doctest
// runner (root tsconfig, no @shared resolution) — see OUTSIDE_VITE_SHARED_RAW.
import { isRecord } from "../../../shared/is-record.js";
import { settleReceipt } from "../input/targets/receipts";
import { buildStreamEntry } from "../lib/stream-entry";
import type { ChatMessage } from "@core/chat/session/messages.js";
import type { ActivityKind, CardStateDetails } from "@core/chat/card-activity.js";
import {
  ChatInitialLoadError,
  HISTORY_TAIL,
  MIN_REAL_USER_MESSAGES,
  logFsm,
  type ChatEvent,
  type InitialSessionInput,
  type SessionInput,
} from "./chat-types";
import { runFakeStream } from "./chat-actors-fakestream";

export const fetchInitialActor = fromPromise<
  { entries: SessionEntry[]; total: number; sessionId: string | null; running: boolean; busy: boolean },
  InitialSessionInput
>(async ({ input }) => {
  if (input.sessionInput === "new") {
    return { entries: [], total: 0, sessionId: null, running: false, busy: false };
  }
  const preloaded = input.initial;
  if (preloaded) {
    // The mounting page already fetched this session (one `chat.bootstrap`
    // round trip covering session resolution + history + status). Throwing on
    // the failed variant routes it through the machine's existing onError.
    if (preloaded.status === "failed") throw new ChatInitialLoadError(preloaded.error);
    return {
      entries: preloaded.entries,
      total: preloaded.total,
      sessionId: preloaded.sessionId,
      running: preloaded.running,
      busy: preloaded.busy,
    };
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
    const raw = msg.event;
    if (isRecord(raw) && raw.type === "content_block_delta" && isRecord(raw.delta)) {
      const delta = raw.delta;
      if (delta.type === "text_delta" && typeof delta.text === "string" && delta.text.length > 0) {
        state.sawTextPartial = true;
        sendBack({ type: "STREAM_TEXT", text: delta.text });
      }
    }
    return;
  }

  if (msg.type === "assistant") {
    for (const block of msg.message.content) {
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
        : `the run reported an error with no detail (subtype: ${msg.subtype}). Common causes: the selected model is unavailable, or this session can't be resumed.`;
      terminal({ type: "STREAM_ERROR", error: `Chat turn failed — ${detail}` });
    } else {
      terminal({ type: "STREAM_RESULT" });
    }
  }
}

/**
 * Map a `startChatTurn` result onto a receipt settlement, shared by the
 * idle-path send (`streamActor`) and the mid-turn queued send
 * (`queueMessageToBackend`) — both report the same three shapes
 * (deduplicated / queued / turnId) plus the no-turnId failure.
 */
function settleFromTurnStart(messageId: string, result: ChatTurnStart): void {
  if (result.deduplicated) {
    settleReceipt({ disposition: "sent", emissionId: messageId, deduplicated: true });
    return;
  }
  if (result.queued) {
    settleReceipt({ disposition: "queued", emissionId: messageId });
    return;
  }
  if (result.turnId) {
    settleReceipt({ disposition: "sent", emissionId: messageId, deduplicated: false });
    return;
  }
  settleReceipt({ disposition: "rejected", emissionId: messageId, reason: "Send returned no turn id" });
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
      // The fake stream never reaches startChatTurn, so settle the receipt
      // here — otherwise it times out to `rejected` 30s in and the dispatcher
      // "restores" the already-running prompt into the composer.
      settleReceipt({ disposition: "sent", emissionId: input.messageId, deduplicated: false });
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
        // Settle the receipt (acceptance-level, BEFORE the stream runs for a
        // turnId result — see settleFromTurnStart) up front for every shape.
        settleFromTurnStart(input.messageId, result);
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
        settleReceipt({ disposition: "rejected", emissionId: input.messageId, reason: msg });
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
 * Fire-and-forget AT THE MACHINE LEVEL: no new machine events come out of
 * this — the backend enqueues the turn and the chat-complete event triggers
 * a history refresh when it finishes. The send OUTCOME is still reported to
 * the receipt registry so the dispatcher's `Promise<Receipt>` settles for a
 * mid-turn queued send, same as the idle-path send in `streamActor`.
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
  })
    .then((result) => settleFromTurnStart(messageId, result))
    .catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : "Send failed";
      settleReceipt({ disposition: "rejected", emissionId: messageId, reason: msg });
    });
}
