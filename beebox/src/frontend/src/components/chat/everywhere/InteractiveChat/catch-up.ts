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
 * On a return after at least {@link CATCH_UP_MIN_HIDDEN_MS} hidden, an idle
 * chat refreshes history over HTTP at once, without waiting for the socket,
 * and marks itself catching up until history lands (the machine's
 * `historySyncs` counts only successful loads, so a failed fetch does not end
 * it) or the live bubble shows new output (trailing half-typed text it
 * hides does not count). The strip shows the label only after
 * {@link CATCH_UP_SHOW_DELAY_MS}, so a near-instant refresh never flashes it.
 * After {@link CATCH_UP_MAX_MS} it ends at the first moment no fetch is in
 * flight.
 */

import { useEffect, useRef, useState } from "react";
import type { ChatEvent } from "../../../../machines/chat-types";
import type { SessionContentBlock } from "../../../../api";
import { visibleStreamText } from "./message-items";
import { chatDisplayPhase, type ChatMachineDisplayPhase, type ChatSnapshotLike } from "./processing-status-display";

/** A hide shorter than this keeps its socket and misses nothing worth a refresh. */
export const CATCH_UP_MIN_HIDDEN_MS = 10_000;
/** A refresh that lands sooner than this shows no label. */
export const CATCH_UP_SHOW_DELAY_MS = 400;
/** After this, stop claiming to catch up once no fetch is in flight. */
export const CATCH_UP_MAX_MS = 20_000;

export interface CatchUpState {
  /** When the page was last hidden; null while visible. */
  hiddenAt: number | null;
  /** History has not landed since the last long-hidden return. */
  active: boolean;
  /** CATCH_UP_MAX_MS has passed; end as soon as no fetch is in flight. */
  expired: boolean;
  /** `historySyncs` at the return; a change means history landed. */
  syncsAtReturn: number;
  /** Stream output size at the return; a change means the live stream delivered. */
  progressAtReturn: number;
}

export const initialCatchUpState: CatchUpState = { hiddenAt: null, active: false, expired: false, syncsAtReturn: 0, progressAtReturn: 0 };

/** What the policy reads from the chat machine. */
export interface CatchUpChat {
  phase: ChatMachineDisplayPhase;
  /** Visible live-bubble text length plus tool count: what the person can see of the stream. */
  progress: number;
  /** The machine's count of successful history loads. */
  syncs: number;
  /** The chat has a session or a turn in flight, so it has history to fall behind on. */
  tracked: boolean;
}

export type CatchUpInput =
  | { type: "hidden"; at: number }
  | { type: "visible"; at: number; chat: CatchUpChat }
  | { type: "observe"; chat: CatchUpChat }
  | { type: "expire"; chat: CatchUpChat };

function fetching(phase: ChatMachineDisplayPhase): boolean {
  return phase === "loading" || phase === "refreshing-turn" || phase === "refreshing-resync";
}

function caughtUp(state: CatchUpState, chat: CatchUpChat): boolean {
  if (chat.syncs !== state.syncsAtReturn) return true;
  if (chat.phase === "streaming" && chat.progress !== state.progressAtReturn) return true;
  return state.expired && !fetching(chat.phase);
}

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
      if (!longHide || !input.chat.tracked) return { state: { ...state, hiddenAt: null }, refresh: false };
      return {
        state: { hiddenAt: null, active: true, expired: false, syncsAtReturn: input.chat.syncs, progressAtReturn: input.chat.progress },
        refresh: input.chat.phase === "idle",
      };
    }
    case "observe":
    case "expire": {
      if (!state.active) return { state, refresh: false };
      const next = input.type === "expire" ? { ...state, expired: true } : state;
      return { state: caughtUp(next, input.chat) ? { ...next, active: false } : next, refresh: false };
    }
  }
}

/** True while the chat should show "Catching up…". */
export function useCatchUp(chat: CatchUpChat & { send: (event: ChatEvent) => void }): boolean {
  const { phase, progress, syncs, tracked, send } = chat;
  const stateRef = useRef<CatchUpState>(initialCatchUpState);
  const latestRef = useRef({ chat: { phase, progress, syncs, tracked }, send });
  const [active, setActive] = useState(false);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const current = { phase, progress, syncs, tracked };
    latestRef.current = { chat: current, send };
    stateRef.current = advanceCatchUp(stateRef.current, { type: "observe", chat: current }).state;
    setActive(stateRef.current.active);
  }, [phase, progress, syncs, tracked, send]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const onChange = () => {
      const latest = latestRef.current;
      const step = advanceCatchUp(stateRef.current, document.visibilityState === "hidden"
        ? { type: "hidden", at: Date.now() }
        : { type: "visible", at: Date.now(), chat: latest.chat });
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
      stateRef.current = advanceCatchUp(stateRef.current, { type: "expire", chat: latestRef.current.chat }).state;
      setActive(stateRef.current.active);
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
  snapshot: ChatSnapshotLike & { context: { sessionId: string | null; streamText: string; streamTools: readonly SessionContentBlock[]; historySyncs: number } };
  send: (event: ChatEvent) => void;
}): boolean {
  const { context } = opts.snapshot;
  const phase = chatDisplayPhase(opts.snapshot);
  return useCatchUp({
    phase,
    progress: visibleStreamText(context).length + context.streamTools.length,
    syncs: context.historySyncs,
    tracked: context.sessionId !== null || phase !== "idle",
    send: opts.send,
  });
}
