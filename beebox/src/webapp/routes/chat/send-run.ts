/**
 * The run behind an acked send: the turn capture the client subscribes to, and
 * the fire-and-forget `send()` that starts the engine after the ack.
 *
 * Split out of `chat-send-routes.ts` — the route decides *whether* to accept a
 * message; this module owns what happens to the turn once it has.
 */

import type { BoxWork } from "../../../lib/box-maintenance/admission.js";
import { startAwakeTimeout } from "../../../shared/awake-timeout.js";
import { errorMessage } from "../../../shared/error-guards.js";
import type { ChatMessage, ChatSendInput, ChatSession } from "../../../core/chat/session/run/core.js";
import { createTurnBuffer, scheduleTurnCleanup } from "../../../core/chat/turn-buffer.js";

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

/** A send admitted after its watchdog already answered the request as refused. */
class SendAbandonedError extends Error {
  constructor() {
    super("Send abandoned before the session took the turn");
    this.name = "SendAbandonedError";
  }
}

/** Whether the session took the turn. Not admitted means nothing was recorded. */
export type RunAdmission = { admitted: true } | { admitted: false; reason: string };

/**
 * Start the run for a send, and report whether the session admitted it.
 *
 * `onAdmitted` runs at the moment the session takes the turn, before the
 * engine starts: that is where the caller records the message, and the
 * returned promise resolves once it has. A send the session refuses first
 * (another send took the turn between the caller's busy check and this one,
 * 14 ms apart on 2026-10-14) resolves `{ admitted: false }` with nothing
 * recorded, so the caller can refuse the request instead of acking a message
 * the agent never gets. A throw before admission, including one from
 * `onAdmitted`, rejects the promise.
 *
 * Nothing awaits the run itself. The client holds its `{turnId}` and is
 * subscribed to the turn stream, so a run that fails to start after admission
 * reports there rather than in an HTTP status. `send()` can *reject* (an
 * FD-exhausted SDK spawn is the case we've seen) or return false; both mean
 * nothing was dispatched, and both fail the capture, which releases the pin
 * and marks the turn errored for every subscriber.
 *
 * A `send()` that does NEITHER is the third case: a wedged run lock or a spawn
 * that never returns leaves the turn buffer unsettled and the session pin held
 * forever. The watchdog bounds that: past `watchdog.timeoutMs` of *awake* time
 * the turn is failed like any other run that never started, and a send not yet
 * admitted is abandoned (its late admission throws, so nothing is recorded).
 * The watchdog is cleared the moment `send()` settles either way, so a long
 * turn that did start is never touched — and if `send()` settles late anyway,
 * `capture.fail` has already no-oped the buffer, so a real result can't be
 * clobbered.
 *
 * The durable claim is deliberately left alone after admission: the user
 * message is already in history, so a redelivery of this id must still be
 * answered `deduplicated`, not recorded a second time.
 */
export function startAckedRun(
  chatSession: Pick<ChatSession, "send">,
  { input, capture, watchdog, work, onAdmitted }: {
    work?: BoxWork;
    input: ChatSendInput;
    capture: TurnCapture;
    /** Records the message; runs once the session holds the turn. */
    onAdmitted?: () => void;
    /** Tests shrink the bound; production omits it. */
    watchdog?: { timeoutMs: number; periodMs: number } | undefined;
  },
): Promise<RunAdmission> {
  const answer: { settle?: (admission: RunAdmission) => void; refuse?: (error: unknown) => void } = {};
  const admission = new Promise<RunAdmission>((resolve, reject) => { answer.settle = resolve; answer.refuse = reject; });
  const settleAdmission = (result: RunAdmission): void => answer.settle?.(result);
  const refuseAdmission = (error: unknown): void => answer.refuse?.(error);
  let admitted = false;
  let abandoned = false;
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
      const reason = `The run did not start within ${describeBound(bound.timeoutMs)}`;
      capture.fail(reason);
      if (!admitted) { abandoned = true; settleAdmission({ admitted: false, reason }); }
    },
  });
  const admit = (): void => {
    if (abandoned) throw new SendAbandonedError();
    onAdmitted?.();
    admitted = true;
    settleAdmission({ admitted: true });
  };
  // A run refused before admission (no login, no provider key) answers with its reason, not "busy".
  let refusedReason: string | null = null;
  const refuse = (reason: string): void => { refusedReason = reason; };
  const send = (): Promise<boolean> => chatSession.send(input, { onAdmitted: admit, onRefused: refuse });
  void (work ? work.run(send) : send())
    .then((sent) => {
      if (!sent) capture.fail(refusedReason ?? "Failed to send message");
      else if (!admitted) console.error("[chat] send() reported success without admitting the turn");
      settleAdmission({ admitted: false, reason: refusedReason ?? "The chat is busy with another message; this one was not sent" });
    })
    .catch((e: unknown) => {
      console.error("[chat] send failed to start a run:", e);
      capture.fail(errorMessage(e));
      refuseAdmission(e);
    })
    .finally(async () => {
      timer.stop();
      await work?.release();
    });
  return admission;
}
