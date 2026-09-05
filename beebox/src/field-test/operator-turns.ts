/**
 * The operator session's turn state machine (`docs/plans/agent-field-tests.md`,
 * Track 3) — one message in, one settled turn out, over a single long-lived
 * `ChatBackendRun`.
 *
 * It lives apart from `operator.ts` because it is the part with actual state:
 * the session wrapper above it is configuration and the questionnaire wiring,
 * while everything subtle — which messages belong to which activity, what
 * happens when an activity is cut short — is here.
 *
 * Two limits bound an activity, both enforced here rather than by the SDK:
 *
 * - **Turn cap.** The SDK's `maxTurns` is per query, and this session is ONE
 *   query for the whole run, so an SDK cap would be a run-wide budget rather
 *   than the per-activity guard the plan asks for. Assistant messages are
 *   counted here instead.
 * - **Timeout.** `startAwakeTimeout`, never a raw `setTimeout` — a plain timer
 *   counts macOS sleep and fires the instant a laptop wakes, which would abort
 *   an activity that had barely started.
 *
 * When either trips, the run is interrupted but the turn does NOT settle yet:
 * it settles on the interrupt's own `result`, so the next activity can never
 * begin while its predecessor's tail is still in the stream. A drain that never
 * produces that result aborts the session instead of quietly reusing it.
 */

import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { ChatBackendRun } from "../services/claude-chat.js";
import { startAwakeTimeout, type AwakeTimeout } from "../lib/awake-timeout.js";
import { errorMessage } from "../lib/error-guards.js";

export type OperatorTurnStatus = "completed" | "turn-capped" | "timed-out" | "error";

export interface OperatorTurn {
  /** The operator's free-text completion note — the SDK result text, falling
   *  back to the assistant text collected during the turn. */
  note: string;
  /** Assistant turns observed during this activity. */
  turns: number;
  status: OperatorTurnStatus;
  /** Why the turn did not complete normally, or null. */
  error: string | null;
}

class OperatorSessionClosedError extends Error {
  constructor() {
    super("Operator session is closed; it cannot be sent another message");
    this.name = "OperatorSessionClosedError";
  }
}

class OperatorTurnInFlightError extends Error {
  constructor() {
    super("Operator session already has a turn in flight — activities are sequential");
    this.name = "OperatorTurnInFlightError";
  }
}

export interface TurnTrackerOptions {
  run: ChatBackendRun;
  /** Assistant turns one activity may take before it is cut short. */
  maxTurns: number;
  /** Awake-time budget for one activity. */
  activityTimeoutMs: number;
  /** Awake time an interrupted activity gets to produce its `result`. */
  drainGraceMs: number;
  /** Tick period for both budgets; tests pass something small. */
  pollMs: number;
}

export interface TurnTracker {
  /** Send one message and resolve when the resulting turn settles. */
  send(text: string): Promise<OperatorTurn>;
  /** The SDK session id, once the backend has reported one. */
  sessionId(): string | null;
  /** End the conversation and wait for the message pump to finish. */
  close(): Promise<void>;
}

interface AbandonReason {
  status: OperatorTurnStatus;
  error: string;
}

interface PendingTurn {
  resolve: (turn: OperatorTurn) => void;
  texts: string[];
  turns: number;
  /** Set once the turn was cut short; it settles when its `result` lands. */
  abandoned: AbandonReason | null;
  /** The budget currently running: the activity's, then the drain grace. */
  timer: AwakeTimeout;
}

/** Assistant text blocks of one SDK assistant message, joined. */
function assistantText(msg: SDKMessage): string {
  if (msg.type !== "assistant") return "";
  const { content } = msg.message;
  if (!Array.isArray(content)) return "";
  return content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

/** The result message's text, or null for a non-success/empty result. */
function resultText(msg: SDKMessage): string | null {
  if (msg.type !== "result" || msg.subtype !== "success") return null;
  return msg.result === "" ? null : msg.result;
}

export function trackOperatorTurns(options: TurnTrackerOptions): TurnTracker {
  const { run, maxTurns, activityTimeoutMs, drainGraceMs, pollMs } = options;
  const state: {
    pending: PendingTurn | null;
    sessionId: string | null;
    streamEnded: boolean;
    stopped: boolean;
    /** Set when an interrupted turn never produced its `result`: the stream is
     *  no longer trustworthy, so no further activity may be sent on it. */
    aborted: boolean;
  } = { pending: null, sessionId: null, streamEnded: false, stopped: false, aborted: false };

  /**
   * Resolve the in-flight turn and clear it. A no-op for a stale pending, so a
   * timer firing as its turn settles cannot resolve it twice. `note` falls back
   * to the assistant text collected during the turn.
   */
  function settle(
    pending: PendingTurn,
    outcome: { status: OperatorTurnStatus; error: string | null; note?: string | null },
  ): void {
    if (state.pending !== pending) return;
    state.pending = null;
    pending.timer.stop();
    pending.resolve({
      note: (outcome.note ?? null) ?? pending.texts.join("\n\n"),
      turns: pending.turns,
      status: outcome.status,
      error: outcome.error,
    });
  }

  /** Cut an activity short (turn cap or timeout) and start the drain grace. */
  function abandon(reason: AbandonReason): void {
    const pending = state.pending;
    if (pending === null || pending.abandoned !== null) return;
    pending.abandoned = reason;
    pending.timer.stop();
    void run.interrupt().catch((e: unknown) => {
      console.warn(`Field-test operator: interrupt after ${reason.status} failed: ${errorMessage(e)}`);
    });
    pending.timer = startAwakeTimeout({
      timeoutMs: drainGraceMs,
      periodMs: pollMs,
      onTimeout: () => {
        if (state.pending !== pending) return;
        state.aborted = true;
        console.error(
          "Field-test operator: an interrupted activity never produced a result; session aborted",
        );
        settle(pending, {
          status: reason.status,
          error: `${reason.error}; the interrupted turn never produced a result`,
        });
      },
    });
  }

  /** One SDK message, against the turn (if any) currently in flight. */
  function handleMessage(msg: SDKMessage): void {
    if (msg.type === "system" && "session_id" in msg && typeof msg.session_id === "string") {
      state.sessionId ??= msg.session_id;
    }
    const pending = state.pending;
    if (pending === null) return;
    const { abandoned } = pending;
    if (abandoned !== null) {
      // Everything between the interrupt and its result belongs to the activity
      // we already gave up on.
      if (msg.type === "result") settle(pending, abandoned);
      return;
    }
    if (msg.type === "assistant") {
      pending.turns += 1;
      const text = assistantText(msg);
      if (text !== "") pending.texts.push(text);
      if (pending.turns > maxTurns) {
        abandon({ status: "turn-capped", error: `activity exceeded its ${String(maxTurns)}-turn cap` });
      }
      return;
    }
    if (msg.type === "result") {
      const failed = msg.is_error || msg.subtype !== "success";
      settle(pending, {
        // The result text is the operator's closing note and repeats the last
        // assistant turn, so it replaces the transcript rather than appending.
        note: resultText(msg),
        status: failed ? "error" : "completed",
        error: failed ? `SDK result ${msg.subtype}` : null,
      });
    }
  }

  /** Settle an in-flight turn as failed (stream error, or stream ended). */
  function failPending(error: string): void {
    const pending = state.pending;
    if (pending !== null) settle(pending, { status: "error", error });
  }

  const pump = (async (): Promise<void> => {
    try {
      for await (const msg of run.messages) {
        if ("provider" in msg) {
          failPending("field-test operator supports only the Claude backend");
        } else {
          handleMessage(msg);
        }
      }
    } catch (e) {
      failPending(errorMessage(e));
    } finally {
      state.streamEnded = true;
      failPending("operator session ended before the turn finished");
    }
  })();
  pump.catch((e: unknown) => {
    // The loop already settles the pending turn; this catches a throw from a
    // settle callback itself, which would otherwise be an ownerless rejection.
    console.error(`Field-test operator message pump failed: ${errorMessage(e)}`);
  });

  return {
    send(text: string): Promise<OperatorTurn> {
      if (state.stopped || state.streamEnded || state.aborted) {
        throw new OperatorSessionClosedError();
      }
      if (state.pending !== null) throw new OperatorTurnInFlightError();
      return new Promise<OperatorTurn>((resolve) => {
        const pending: PendingTurn = {
          resolve,
          texts: [],
          turns: 0,
          abandoned: null,
          timer: startAwakeTimeout({
            timeoutMs: activityTimeoutMs,
            periodMs: pollMs,
            onTimeout: (elapsed) => {
              if (state.pending !== pending) return;
              abandon({
                status: "timed-out",
                error: `no completion after ${String(elapsed.awakeMs)}ms of awake time`,
              });
            },
          }),
        };
        state.pending = pending;
        run.send([{ type: "text", text }]);
      });
    },
    sessionId: () => state.sessionId,
    async close(): Promise<void> {
      state.stopped = true;
      // Closing the run only ends the input side; it does not stop a turn the
      // model is still working on. Interrupt first and settle the caller's
      // promise, so `stop()` cannot block on an activity nobody is waiting for
      // any more (and cannot leave its budget timer ticking).
      const pending = state.pending;
      if (pending !== null) {
        void run.interrupt().catch((e: unknown) => {
          console.warn(`Field-test operator: interrupt on close failed: ${errorMessage(e)}`);
        });
        settle(pending, {
          status: "error",
          error: "operator session was stopped while the activity was still running",
        });
      }
      await run.close();
      await pump;
    },
  };
}
