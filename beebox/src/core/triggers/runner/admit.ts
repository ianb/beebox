/**
 * Admission of one evaluation's result, the fire, and the state write, all
 * inside one hold of the session's trigger lock (the caller holds it). The
 * activation is reread: gone, terminal or expired means the result is
 * `stale` and nothing is delivered. Otherwise `lastEvalSeq` advances, an
 * `error` sets `failed`, a normal return restores a `failed` activation to
 * `armed`, a result inside the fire floor is `suppressed`, and a fire that
 * cannot be delivered ends the activation as `delivery-failed`.
 */

import { errorMessage } from "../../../shared/error-guards.js";
import { serializeTrigger } from "../../../shared/delivered-trigger-message.js";
import { UserMessageDeliveryError } from "../../chat/session/deliver-user-message.js";
import { applyExpiry, readActivationFile, TERMINAL_STATES, updateActivationsLocked, type Activation, type TriggerSession } from "../activation.js";
import type { EvalOutput } from "../eval.js";
import type { TraceOutcome } from "../trace.js";
import { TEXT_CAP } from "../types.js";

/** A result inside this long of the last fire is suppressed. */
export const FIRE_FLOOR_MS = 5000;

export interface AdmitArgs {
  who: TriggerSession;
  activationId: string;
  output: EvalOutput;
  /** The highest `seq` the evaluation was given; `lastEvalSeq` advances to it. */
  maxSeq: number;
  /** How many new entries the evaluation was given. */
  entries: number;
  now: Date;
  deliver: (args: { sessionId: string; message: string }) => Promise<void>;
}

export interface Admission {
  outcome: TraceOutcome;
  error: string | undefined;
  /** Whether `state` or `error` changed, so the caller emits `trigger-changed`. */
  changed: boolean;
  label: string;
  /** The activation reached a terminal state here, so its timers can go. */
  ended: boolean;
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
    if (current?.state === "expired" && stored?.state !== "expired") await updateActivationsLocked(who, { now, fn: (a) => a });
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
      if (next.lastFireAt !== undefined && now.getTime() - Date.parse(next.lastFireAt) < FIRE_FLOOR_MS) {
        admission = { ...admission, outcome: "suppressed" };
      } else {
        const text = final.text.length > TEXT_CAP ? `${final.text.slice(0, TEXT_CAP - 1)}…` : final.text;
        const message = serializeTrigger({ kind: "trigger", label: current.label, file: current.file, fire: next.fires + 1, entries: args.entries, done: final.done === true, text, note: final.note ?? null });
        try {
          await args.deliver({ sessionId: who.sessionId, message });
          next = { ...next, fires: next.fires + 1, lastFireAt: now.toISOString(), ...(final.done === true ? { state: "done" } : {}) };
          admission = { ...admission, outcome: "fired", changed: true, ended: final.done === true };
        } catch (e) {
          const error = e instanceof UserMessageDeliveryError ? "the chat refused the message" : `the send failed: ${errorMessage(e)}`;
          next = { ...next, state: "delivery-failed", error };
          admission = { ...admission, outcome: "delivery-failed", error, changed: true, ended: true };
        }
      }
    }
  }
  const written = next;
  await updateActivationsLocked(who, { now, fn: (activations) => activations.map((a) => (a.id === activationId ? written : a)) });
  return admission;
}
