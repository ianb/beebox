/**
 * The run behind an acked send: the turn capture the client subscribes to, and
 * the fire-and-forget `send()` that starts the engine after the ack.
 *
 * Split out of `chat-send-routes.ts` — the route decides *whether* to accept a
 * message; this module owns what happens to the turn once it has.
 */

import { startAwakeTimeout } from "../../lib/awake-timeout.js";
import { errorMessage } from "../../lib/error-guards.js";
import type { ChatMessage, ChatSendInput, ChatSession } from "../../core/chat/session/index.js";
import { createTurnBuffer, scheduleTurnCleanup } from "../../core/chat/turn-buffer.js";

/** The one thing the route keeps from a captured turn: how to fail it. */
export interface TurnCapture {
  fail: (reason: string) => void;
}

/**
 * How long a `send()` may take to either start a run or fail before the turn is
 * failed for the client. Generous on purpose: a cold engine spawn legitimately
 * takes minutes, so this is the "something is wedged" bound (a lock nobody
 * releases, a spawn that never returns), not a latency budget.
 */
const RUN_START_TIMEOUT_MS = 10 * 60 * 1000;
const RUN_START_TICK_MS = 5_000;

/** How the watchdog names its own bound, for the client-visible failure. */
function describeBound(timeoutMs: number): string {
  if (timeoutMs < 60_000) return `${timeoutMs}ms`;
  return `${Math.round(timeoutMs / 60_000)} minutes`;
}

/**
 * Capture an in-flight turn's messages into a resumable buffer keyed by
 * `turnId`, instead of piping them to one client socket. The turn now outlives
 * any single connection: the client subscribes to `chat.turnStream` for the
 * output and can drop/reconnect without losing it. The pin is released and the
 * buffer scheduled for GC once the turn settles (done / error / session close).
 *
 * Wired up *before* the send so no early frame (system/init, an immediate
 * result, a fast subprocess) is dropped between send-resolves and listener-
 * attach. Returns `fail`, which the caller invokes when the run never starts —
 * the client already has its `{turnId}` and is subscribed, so the failure is
 * delivered as the buffer's error frame rather than discarded with the buffer.
 */
export function captureTurn(chatSession: ChatSession, { turnId, releasePin }: { turnId: string; releasePin: () => void }): TurnCapture {
  const buffer = createTurnBuffer(turnId);

  let settled = false;
  const detach = (): void => {
    chatSession.removeListener("message", onMessage);
    chatSession.removeListener("done", onDone);
    chatSession.removeListener("error", onError);
    chatSession.removeListener("close", onClose);
  };
  const settle = (): void => {
    if (settled) return;
    settled = true;
    detach();
    releasePin();
    scheduleTurnCleanup(turnId);
  };

  const onMessage = (msg: ChatMessage): void => buffer.push(msg);
  const onDone = (): void => {
    buffer.finish();
    settle();
  };
  const onError = (err: Error): void => {
    buffer.fail(err.message);
    settle();
  };
  // The subprocess exited without a `done` (crash / intentional stop). Mark the
  // turn complete so a resuming subscriber stops waiting and falls back to
  // history rather than hanging.
  const onClose = (): void => {
    buffer.finish();
    settle();
  };

  chatSession.on("message", onMessage);
  chatSession.on("done", onDone);
  chatSession.on("error", onError);
  chatSession.on("close", onClose);

  // The run never started. The buffer is kept, not removed: it is where the
  // subscribed client learns the turn died, and an empty removed buffer would
  // read as "resync" — a silent history refresh with no error shown. Settles
  // like any other terminal state (detach + release pin + GC). No-op once
  // settled, so a late `close` can't overwrite the error.
  const fail = (reason: string): void => {
    if (settled) return;
    buffer.fail(reason);
    settle();
  };

  return { fail };
}

/**
 * Start the run for a send that has already been acked.
 *
 * Nothing awaits this. The client holds its `{turnId}` and is subscribed to the
 * turn stream, so a run that fails to start reports there rather than in an
 * HTTP status. `send()` can *reject* (an FD-exhausted SDK spawn is the case
 * we've seen) or return false; both mean the same thing — it only fails before
 * reaching the backend, so nothing was dispatched — and both fail the capture,
 * which releases the pin and marks the turn errored for every subscriber.
 *
 * A `send()` that does NEITHER is the third case: a wedged run lock or a spawn
 * that never returns leaves the turn buffer unsettled and the session pinned
 * forever, while the client streams a turn that will never produce a frame and
 * every retry of its message id is answered `deduplicated: true`. The watchdog
 * bounds that: past `watchdog.timeoutMs` of *awake* time the turn is failed
 * like any other run that never started. It is cleared the moment `send()`
 * settles either way, so a long turn that did start is never touched — and if
 * `send()` settles late anyway, `capture.fail` has already no-oped the buffer,
 * so a real result can't be clobbered.
 *
 * The durable claim is deliberately left alone: the user message is already in
 * history, so a redelivery of this id must still be answered `deduplicated`,
 * not recorded a second time.
 */
export function startAckedRun(
  chatSession: Pick<ChatSession, "send">,
  { input, capture, watchdog }: {
    input: ChatSendInput;
    capture: TurnCapture;
    /** Tests shrink the bound; production omits it. */
    watchdog?: { timeoutMs: number; periodMs: number } | undefined;
  },
): void {
  const bound = watchdog ?? { timeoutMs: RUN_START_TIMEOUT_MS, periodMs: RUN_START_TICK_MS };
  const timer = startAwakeTimeout({
    timeoutMs: bound.timeoutMs,
    periodMs: bound.periodMs,
    onTimeout: () => {
      console.error(
        `[chat] send() neither started nor failed a run within ${describeBound(bound.timeoutMs)} — ` +
          "failing the turn so the client stops waiting and the session pin is released. " +
          "Suspect a run lock nobody released or a subprocess spawn that never returned.",
      );
      capture.fail(`The run did not start within ${describeBound(bound.timeoutMs)}`);
    },
  });
  void chatSession
    .send(input)
    .then((sent) => {
      if (!sent) capture.fail("Failed to send message");
    })
    .catch((e: unknown) => {
      console.error("[chat] send failed to start a run:", e);
      capture.fail(errorMessage(e));
    })
    .finally(() => {
      timer.stop();
    });
}
