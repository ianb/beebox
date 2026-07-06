/**
 * The chat run lifecycle as a discriminated union + a transition guard.
 *
 * Both `ChatSession` (whole-box interactive chat) and `ChatThreadSession`
 * (per-thread chat) drive one long-lived SDK run through the same phases.
 * Historically each tracked that lifecycle with a `busy` boolean, a nullable
 * `run` handle, and (in ChatSession) an `intentionalStop` latch — three fields
 * whose only legal combinations were a subset the types never expressed. This
 * models the phases explicitly so illegal states (streaming with no run, busy
 * while idle) are unrepresentable, and centralises the legal moves in one
 * table the write sites assert against.
 *
 * Phases:
 * - `idle` — no SDK run. The start state, and where every run ends up.
 * - `starting` — `startRun()` is mid-flight (docs refresh, lock, backend
 *   spawn); the run handle doesn't exist yet.
 * - `ready` — a run is open and idle, waiting for the next turn. A completed
 *   turn returns here without tearing the run down, so the next message reuses it.
 * - `streaming` — a turn is in flight; the SDK is producing messages.
 * - `stopping` — a graceful `stop()` closed the run; the close handler will
 *   land in `idle` *without* draining the queue. `wasBusy` preserves the
 *   `isBusy()` reading until the run actually ends (a turn was interrupted).
 *   Only ChatSession uses this — ChatThreadSession has no queue to protect, so
 *   its stop/park close straight through `ready`/`streaming` → `idle`.
 */

import type { ChatBackendRun } from "../services/claude-chat.js";
import { invariant } from "../lib/invariant.js";

export type ChatRunPhase = "idle" | "starting" | "ready" | "streaming" | "stopping";

export type ChatLifecycle =
  | { phase: "idle" }
  | { phase: "starting" }
  | { phase: "ready"; run: ChatBackendRun }
  | { phase: "streaming"; run: ChatBackendRun }
  | { phase: "stopping"; run: ChatBackendRun; wasBusy: boolean };

/** The single idle value (no per-instance data). */
export const IDLE: ChatLifecycle = { phase: "idle" };

/**
 * Legal phase transitions. Keyed by `ChatRunPhase`, so adding a phase fails to
 * compile until its edges are declared — the table can't drift from the union.
 *
 * - `idle → starting` — a send with no open run kicks off `startRun`.
 * - `starting → ready` — the backend run was created.
 * - `ready → streaming` — a turn is sent onto the open run.
 * - `streaming → ready` — the turn's `result` arrived; the run stays open.
 * - `ready|streaming → stopping` — a graceful `stop()`.
 * - `ready|streaming|stopping → idle` — the run ended (result-less close,
 *   restart, unexpected death, or the completion of a `stop()`).
 */
const LEGAL_TRANSITIONS: Record<ChatRunPhase, readonly ChatRunPhase[]> = {
  idle: ["starting"],
  starting: ["ready", "idle"],
  ready: ["streaming", "stopping", "idle"],
  streaming: ["ready", "stopping", "idle"],
  stopping: ["idle"],
};

/** Whether the run may move directly from `from` to `to`. */
export function isLegalChatPhaseTransition(from: ChatRunPhase, to: ChatRunPhase): boolean {
  return LEGAL_TRANSITIONS[from].includes(to);
}

/**
 * Return `to`, asserting the move from `from` is legal. Callers assign the
 * result to their lifecycle field, so an illegal transition (a caller bug over
 * internal state) fails loudly rather than persisting an impossible phase.
 */
export function nextLifecycle(from: ChatLifecycle, to: ChatLifecycle): ChatLifecycle {
  invariant(
    isLegalChatPhaseTransition(from.phase, to.phase),
    `illegal chat lifecycle transition: ${from.phase} → ${to.phase}`,
  );
  return to;
}

/**
 * Advance the lifecycle when a turn's `result` arrives. `streaming` returns to
 * `ready` (run stays open, `isBusy()` flips false); a `stopping` in progress
 * records that the turn ended but stays closing; anything else is unchanged.
 */
export function afterTurnResult(state: ChatLifecycle): ChatLifecycle {
  if (state.phase === "streaming") return nextLifecycle(state, { phase: "ready", run: state.run });
  if (state.phase === "stopping") return { ...state, wasBusy: false };
  return state;
}

/** The open run handle for phases that carry one, else null. */
export function lifecycleRun(state: ChatLifecycle): ChatBackendRun | null {
  switch (state.phase) {
    case "idle":
    case "starting":
      return null;
    case "ready":
    case "streaming":
    case "stopping":
      return state.run;
  }
}

/** Whether a turn is in flight, matching the old `busy` field's readings. */
export function lifecycleBusy(state: ChatLifecycle): boolean {
  switch (state.phase) {
    case "idle":
    case "starting":
    case "ready":
      return false;
    case "streaming":
      return true;
    case "stopping":
      return state.wasBusy;
  }
}
