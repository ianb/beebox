/**
 * "Catching up…": the chat's sign that its transcript may be out of date
 * after the page was hidden for a while.
 *
 * Coming back to a chat after a long background (the iOS app suspends its web
 * view; a desktop tab can lose its socket) shows the transcript as it was when
 * the person left. The newer history arrives only after the socket reconnects
 * and the deferred reconnect REFRESH runs (`ws.ts`, `lib/deferred-resync.ts`),
 * which on iOS takes seconds. Until then the chat reads as "the agent did
 * nothing" (issues/bugs/2026-11-01-chat-return-shows-old-transcript-with-no-loading-sign.md).
 *
 * On a return after at least {@link CATCH_UP_MIN_HIDDEN_MS} hidden, the chat
 * refreshes history over HTTP at once, without waiting for the socket, and
 * marks itself catching up until fresh data lands: a history fetch finishes,
 * or a live stream delivers new output. The strip shows the label only after
 * {@link CATCH_UP_SHOW_DELAY_MS}, so a near-instant refresh never flashes it,
 * and drops it after {@link CATCH_UP_MAX_MS} whatever happened.
 */

import { useEffect, useRef, useState } from "react";
import type { ChatEvent } from "../../../../machines/chat-types";
import { chatDisplayPhase, type ChatMachineDisplayPhase, type ChatSnapshotLike } from "./processing-status-display";

/** A hide shorter than this keeps its socket and misses nothing worth a refresh. */
export const CATCH_UP_MIN_HIDDEN_MS = 10_000;
/** A refresh that lands sooner than this shows no label. */
export const CATCH_UP_SHOW_DELAY_MS = 400;
/** Never claim to be catching up for longer than this. */
export const CATCH_UP_MAX_MS = 20_000;

export interface CatchUpState {
  /** When the page was last hidden; null while visible. */
  hiddenAt: number | null;
  /** Fresh data has not landed since the last long-hidden return. */
  active: boolean;
  /** A history fetch (loading or refreshing) ran since the return. */
  sawFetch: boolean;
  /** Stream output size at the return; a change means the live stream delivered. */
  progressAtReturn: number;
}

export const initialCatchUpState: CatchUpState = { hiddenAt: null, active: false, sawFetch: false, progressAtReturn: 0 };

export type CatchUpInput =
  | { type: "hidden"; at: number }
  /** `tracked`: the chat has a session or a turn in flight, so it has history to fall behind on. */
  | { type: "visible"; at: number; phase: ChatMachineDisplayPhase; progress: number; tracked: boolean }
  | { type: "observe"; phase: ChatMachineDisplayPhase; progress: number }
  | { type: "expire" };

/**
 * One step of the catch-up policy. `refresh` asks the caller to send REFRESH:
 * only on a long-hidden return to an idle chat. A streaming chat ignores
 * REFRESH, and its own stream resume or watchdog brings it up to date.
 */
export function advanceCatchUp(state: CatchUpState, input: CatchUpInput): { state: CatchUpState; refresh: boolean } {
  switch (input.type) {
    case "hidden":
      return { state: { ...state, hiddenAt: state.hiddenAt ?? input.at }, refresh: false };
    case "visible": {
      if (state.hiddenAt === null) return { state, refresh: false };
      const longHide = input.at - state.hiddenAt >= CATCH_UP_MIN_HIDDEN_MS;
      if (!longHide || !input.tracked) return { state: { ...state, hiddenAt: null }, refresh: false };
      return {
        state: { hiddenAt: null, active: true, sawFetch: input.phase !== "idle" && input.phase !== "streaming", progressAtReturn: input.progress },
        refresh: input.phase === "idle",
      };
    }
    case "observe": {
      if (!state.active) return { state, refresh: false };
      if (input.phase === "idle" && state.sawFetch) return { state: { ...state, active: false }, refresh: false };
      if (input.phase === "streaming" && input.progress !== state.progressAtReturn) return { state: { ...state, active: false }, refresh: false };
      if (input.phase !== "idle" && input.phase !== "streaming" && !state.sawFetch) return { state: { ...state, sawFetch: true }, refresh: false };
      return { state, refresh: false };
    }
    case "expire":
      return { state: { ...state, active: false }, refresh: false };
  }
}

/** True while the chat should show "Catching up…". */
export function useCatchUp(opts: { phase: ChatMachineDisplayPhase; progress: number; tracked: boolean; send: (event: ChatEvent) => void }): boolean {
  const { phase, progress, tracked, send } = opts;
  const stateRef = useRef<CatchUpState>(initialCatchUpState);
  const latestRef = useRef({ phase, progress, tracked, send });
  const [active, setActive] = useState(false);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    latestRef.current = { phase, progress, tracked, send };
    const step = advanceCatchUp(stateRef.current, { type: "observe", phase, progress });
    stateRef.current = step.state;
    setActive(step.state.active);
  }, [phase, progress, tracked, send]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const onChange = () => {
      const latest = latestRef.current;
      const step = advanceCatchUp(stateRef.current, document.visibilityState === "hidden"
        ? { type: "hidden", at: Date.now() }
        : { type: "visible", at: Date.now(), phase: latest.phase, progress: latest.progress, tracked: latest.tracked });
      stateRef.current = step.state;
      setActive(step.state.active);
      if (step.refresh) latest.send({ type: "REFRESH" });
    };
    if (document.visibilityState === "hidden") onChange();
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }, []);

  useEffect(() => {
    setShown(false);
    if (!active) return;
    const showId = setTimeout(() => setShown(true), CATCH_UP_SHOW_DELAY_MS);
    const expireId = setTimeout(() => {
      stateRef.current = advanceCatchUp(stateRef.current, { type: "expire" }).state;
      setActive(false);
    }, CATCH_UP_MAX_MS);
    return () => {
      clearTimeout(showId);
      clearTimeout(expireId);
    };
  }, [active]);

  return active && shown;
}

/** {@link useCatchUp} fed from the chat machine's snapshot. */
export function useChatCatchUp(opts: {
  snapshot: ChatSnapshotLike & { context: { sessionId: string | null; streamText: string; streamTools: readonly unknown[] } };
  send: (event: ChatEvent) => void;
}): boolean {
  const { context } = opts.snapshot;
  const phase = chatDisplayPhase(opts.snapshot);
  return useCatchUp({
    phase,
    progress: context.streamText.length + context.streamTools.length,
    tracked: context.sessionId !== null || phase !== "idle",
    send: opts.send,
  });
}
