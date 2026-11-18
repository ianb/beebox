/**
 * Admission of one evaluation's result, the fire, and the state write, all
 * inside one hold of the session's trigger lock (the caller holds it). The
 * activation is reread: gone, terminal or expired means the result is
 * `stale` and nothing is delivered. Otherwise `lastEvalSeq` advances, an
 * `error` sets `failed`, a normal return restores a `failed` activation to
 * `armed`, a result inside the fire floor is `suppressed`, and a fire that
 * cannot be delivered ends the activation as `delivery-failed`. A result with
 * `done` and no text ends the activation quietly: nothing is delivered.
 *
 * The lock is held through the message's admission, not through a cold
 * engine start (which can take 30 s while a disarm waits 5 s): once the chat
 * has taken the message, the fire is written and the lock released; a send
 * that then fails is written as `delivery-failed` in a second short hold
 * (`settleDelivery`).
 */

import { errorMessage } from "../../../shared/error-guards.js";
import { serializeTrigger } from "../../../shared/delivered-trigger-message.js";
import { UserMessageDeliveryError } from "../../chat/session/deliver-user-message.js";
import { applyExpiry, readActivationFile, TERMINAL_STATES, updateActivationsLocked, type Activation, type TriggerSession } from "../activation.js";
import type { EvalOutput } from "../eval.js";
import type { TraceOutcome } from "../trace.js";
import { TEXT_CAP } from "../types.js";

/** A result inside this long of the last fire is suppressed. */
const FIRE_FLOOR_MS = 5000;

export interface AdmitArgs {
  who: TriggerSession;
  activationId: string;
  output: EvalOutput;
  /** The highest `seq` the evaluation was given; `lastEvalSeq` advances to it. */
  maxSeq: number;
  /** How many new entries the evaluation was given. */
  entries: number;
  /** The card the latest entry came from (its pane card when inside one): the notice's default link. */
  card: string | null;
  now: Date;
  deliver: Deliver;
}

/** Deliver a fire; `onAdmitted` fires once the chat has taken the message. Throws `UserMessageDeliveryError` when refused, anything else when the send is uncertain. */
export type Deliver = (args: { sessionId: string; message: string; onAdmitted: () => void }) => Promise<void>;

export interface Admission {
  outcome: TraceOutcome;
  error: string | undefined;
  /** Whether `state` or `error` changed, so the caller emits `trigger-changed`. */
  changed: boolean;
  label: string;
  /** The activation reached a terminal state here, so its timers can go. */
  ended: boolean;
  /** A send admitted but not yet finished; the caller awaits it outside the lock and calls `settleDelivery` if it fails. */
  pending?: Promise<void> | undefined;
}

function withoutError(activation: Activation): Activation {
  const { error: _cleared, ...rest } = activation;
  return rest;
}

/** Call under the session's trigger lock. */
export async function admitResult(args: AdmitArgs): Promise<Admission> {
  const { who, activationId, output, now } = args;
  const read = await readActivationFile(who);
  const stored = read.invalid ? undefined : read.activations.find((a) => a.id === activationId);
  const current = stored === undefined ? undefined : applyExpiry(stored, now);
  if (current === undefined || TERMINAL_STATES.includes(current.state)) {
    // An expiry the clock shows is written through so the status line agrees.
    if (current?.state === "expired" && stored?.state !== "expired") await updateActivationsLocked(who, { now, announce: false, fn: (a) => a });
    return { outcome: "stale", error: undefined, changed: current?.state === "expired" && stored?.state !== "expired", label: current?.label ?? "", ended: false };
  }
  const wasFailed = current.state === "failed";
  const storedError = current.error;
  let next: Activation = { ...current, lastEvalSeq: Math.max(current.lastEvalSeq, args.maxSeq), lastEvalAt: now.toISOString() };
  let admission: Admission = { outcome: "none", error: undefined, changed: false, label: current.label, ended: false };
  const final = output.final;
  if (final.kind === "error") {
    next = { ...next, state: "failed", error: final.message };
    admission = { ...admission, outcome: "error", error: final.message, changed: !wasFailed || storedError !== final.message };
  } else {
    if (wasFailed) {
      next = { ...withoutError(next), state: "armed" };
      admission = { ...admission, changed: true };
    }
    if (final.kind === "result") {
      const text = final.text;
      if (text === undefined) {
        // Quiet end: nothing to say, nothing delivered; the agent hears of it through the hint.
        next = { ...next, state: "done" };
        admission = { ...admission, outcome: "done", changed: true, ended: true };
      } else if (next.lastFireAt !== undefined && now.getTime() - Date.parse(next.lastFireAt) < FIRE_FLOOR_MS) {
        // The notice is dropped, but a `done` with it still ends the activation, quietly.
        if (final.done === true) next = { ...next, state: "done" };
        admission = { ...admission, outcome: "suppressed", ...(final.done === true ? { changed: true, ended: true } : {}) };
      } else {
        const fired = await fire(args, { current, next, text, note: final.note, done: final.done === true, card: final.card });
        next = fired.next;
        admission = { ...admission, ...fired.admission };
      }
    }
  }
  const written = next;
  // Announcing stays with the store here: this write can also persist another activation's expiry, which the runner's `changed` would not report.
  await updateActivationsLocked(who, { now, fn: (activations) => activations.map((a) => (a.id === activationId ? written : a)) });
  return admission;
}

/** Serialize and send one notice; the activation's next state and the admission fields for the outcome. */
async function fire(
  args: AdmitArgs,
  result: { current: Activation; next: Activation; text: string; note: string | undefined; done: boolean; card: string | undefined },
): Promise<{ next: Activation; admission: Partial<Admission> }> {
  const { current, next, done } = result;
  const text = result.text.length > TEXT_CAP ? `${result.text.slice(0, TEXT_CAP - 1)}…` : result.text;
  const message = serializeTrigger({ kind: "trigger", label: current.label, file: current.file, card: result.card ?? args.card, fire: next.fires + 1, entries: args.entries, done, text, note: result.note ?? null });
  const sent = await startDelivery(args.deliver, { sessionId: args.who.sessionId, message });
  if (sent.kind === "failed") {
    const error = deliveryError(sent.error);
    return { next: { ...next, state: "delivery-failed", error }, admission: { outcome: "delivery-failed", error, changed: true, ended: true } };
  }
  // A fire that ends the activation has told the agent itself; only a quiet end waits for the hint.
  return {
    next: { ...next, fires: next.fires + 1, lastFireAt: args.now.toISOString(), ...(done ? { state: "done", noticed: true } : {}) },
    admission: { outcome: "fired", changed: true, ended: done, pending: sent.kind === "admitted" ? sent.pending : undefined },
  };
}

type DeliveryStart = { kind: "delivered" } | { kind: "admitted"; pending: Promise<void> } | { kind: "failed"; error: unknown };

/** Start the send and wait only until it is admitted or finished, whichever comes first. */
function startDelivery(deliver: Deliver, args: { sessionId: string; message: string }): Promise<DeliveryStart> {
  return new Promise((resolve) => {
    let settled = false;
    const once = (start: DeliveryStart): void => { if (!settled) { settled = true; resolve(start); } };
    const pending = deliver({ ...args, onAdmitted: () => { once({ kind: "admitted", pending }); } })
      .then(() => { once({ kind: "delivered" }); }, (error: unknown) => { once({ kind: "failed", error }); if (settled) throw error; });
    // A rejection after admission is for `settleDelivery`; the extra handler above keeps it from being unhandled only when nobody awaits `pending`.
    pending.catch(() => {});
  });
}

function deliveryError(e: unknown): string {
  return e instanceof UserMessageDeliveryError ? "the chat refused the message" : `the send failed: ${errorMessage(e)}`;
}

/** A send that failed after admission: write `delivery-failed` unless the activation was disarmed meanwhile. Call under the lock. */
export async function settleDelivery(who: TriggerSession, args: { activationId: string; error: unknown; now: Date }): Promise<{ error: string; ended: boolean }> {
  const error = deliveryError(args.error);
  let ended = false;
  await updateActivationsLocked(who, {
    now: args.now,
    fn: (activations) => activations.map((a) => {
      if (a.id !== args.activationId || a.state === "disarmed") return a;
      ended = true;
      return { ...a, state: "delivery-failed", error };
    }),
  });
  return { error, ended };
}
