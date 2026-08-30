/** Display policy for the chat's "Agent is working…" status strip. */

import { useEffect, useRef, useState } from "react";
import { getChatStatus } from "../../api";
import type { ChatEvent } from "../../machines/chat-types";

/**
 * The chat machine's state, as the strip sees it. `refreshing` is split by
 * cause (`context.refreshCause` in `chatMachine.ts`): `refreshing-turn` follows a local
 * stream — the agent just worked and the transcript is being reconciled —
 * while `refreshing-resync` is the global REFRESH (a WS (re)connect, a
 * `chat-complete` broadcast on an idle chat, a status poll that read idle).
 * Only the former is the agent working; a resync on an idle chat is a plain
 * history round-trip and must never paint the strip. The reported flash
 * (issues/bugs/2026-08-05-open-chat-flashes-agent-working-no-send.md) was
 * exactly that: the reconnect gate's trailing timer fires a REFRESH ~5s
 * after every mount.
 */
export type ChatMachineDisplayPhase = "loading" | "idle" | "streaming" | "refreshing-turn" | "refreshing-resync";
export type ProcessingBusyConfirmation = "unconfirmed" | "confirmed";

/** The chat machine is flat, so its state value is a plain state-name string. */
export interface ChatSnapshotLike {
  value: "loading" | "idle" | "streaming" | "refreshing";
  context: { refreshCause: "turn" | "resync" };
}

export function chatDisplayPhase(snapshot: ChatSnapshotLike): ChatMachineDisplayPhase {
  if (snapshot.value !== "refreshing") return snapshot.value;
  return snapshot.context.refreshCause === "turn" ? "refreshing-turn" : "refreshing-resync";
}

export function shouldShowAgentWorking(input: {
  phase: ChatMachineDisplayPhase;
  processBusy: boolean;
  confirmation: ProcessingBusyConfirmation;
}): boolean {
  if (input.phase === "streaming" || input.phase === "refreshing-turn") return true;
  return input.processBusy && input.confirmation === "confirmed";
}

/** Consecutive server-idle polls (5s apart) before a wedged stream is
 *  recovered. Three (~15s of confirmed idle) is far past the frames-in-flight
 *  window at a healthy turn end, where `busy` flips false milliseconds before
 *  STREAM_RESULT lands. */
export const STREAM_WATCHDOG_IDLE_POLLS = 3;

/**
 * One watchdog poll result folded into the running idle count. `busy` resets
 * the count (the server is genuinely working); an idle poll increments it;
 * `recover` fires at the threshold. Pure so the policy is doctestable apart
 * from the timers.
 */
export function streamWatchdogAdvance(input: { busy: boolean; idlePolls: number }): {
  idlePolls: number;
  recover: boolean;
} {
  const idlePolls = input.busy ? 0 : input.idlePolls + 1;
  return { idlePolls, recover: idlePolls >= STREAM_WATCHDOG_IDLE_POLLS };
}

/**
 * Confirm a load-time busy snapshot after 250ms, then poll every 5s while the
 * agent is busy with no live stream attached. A transient snapshot never
 * paints the status strip; a sustained turn appears after one status read.
 *
 * Also the stream watchdog: the machine's `streaming` state is exited ONLY by
 * frames or terminal callbacks on the per-turn WS subscription — if the socket
 * dies and never reconnects, nothing else ever clears "Agent is working…",
 * while the server (whose `busy` is in-process truth, no WS involved) has long
 * been idle. Seen in a field test: 20+ minutes of "Agent is working…" after
 * the turn had finished and written its card. While streaming, poll the
 * server; after STREAM_WATCHDOG_IDLE_POLLS consecutive idle reads, send
 * STREAM_RECOVER — the machine's stalled-stream path, which refreshes history
 * and folds any partial stream text into the transcript rather than dropping
 * it. A failed poll counts as nothing (never turn a network blip into a false
 * recovery); a busy read resets the count.
 */
export function useProcessingStatusPoll(opts: {
  processBusy: boolean;
  snapshot: ChatSnapshotLike;
  sessionId: string | null;
  send: (event: ChatEvent) => void;
}): boolean {
  const { processBusy, snapshot, sessionId, send } = opts;
  const phase = chatDisplayPhase(snapshot);
  const isStreamingState = phase === "streaming";
  /** Any state with a turn's stream or fetch in flight — the confirmation poll stands down. */
  const isStreaming = isStreamingState || phase === "refreshing-turn" || phase === "refreshing-resync";
  const [confirmation, setConfirmation] = useState<{ sessionId: string; value: "confirmed" } | null>(null);
  useEffect(() => {
    if (!processBusy || isStreamingState) setConfirmation(null);
  }, [processBusy, isStreamingState, sessionId]);
  useEffect(() => {
    if (!processBusy || isStreaming || !sessionId) return;
    let ignored = false;
    const poll = () => {
      getChatStatus({ sessionId })
        .then((status) => {
          if (ignored) return;
          if (status.busy) {
            setConfirmation({ sessionId, value: "confirmed" });
          } else {
            // Not busy after all: drop any earlier confirmation and pick up
            // whatever the turn wrote. The REFRESH is a `resync` refresh —
            // unconfirmed, so it never paints the strip.
            setConfirmation(null);
            send({ type: "REFRESH" });
          }
        })
        .catch((e: unknown) => {
          console.warn(`[chatfsm] processing-status poll failed: ${e instanceof Error ? e.message : String(e)}`);
          if (!ignored) setConfirmation({ sessionId, value: "confirmed" });
        });
    };
    const confirmationId = setTimeout(poll, 250);
    const pollId = setInterval(poll, 5000);
    return () => {
      ignored = true;
      clearTimeout(confirmationId);
      clearInterval(pollId);
    };
  }, [processBusy, isStreaming, sessionId, send]);
  // The registry keys a session's busy entry under the id the CLIENT
  // initiated it with: a pending "new" session is re-keyed to its assigned id,
  // but a resumed session whose SDK rotates ids on resume keeps its ORIGINAL
  // key — `registry.get(rotatedId)` is null and reads as idle, while
  // SESSION_ASSIGNED rewrites the machine's sessionId to the rotated id
  // mid-turn. Polling the live sessionId would therefore false-recover a
  // healthy resumed turn; freeze the first non-null id of each streaming
  // episode instead — that is the key the busy entry actually lives under.
  const watchdogIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!isStreamingState) {
      watchdogIdRef.current = null;
      return;
    }
    if (watchdogIdRef.current === null) watchdogIdRef.current = sessionId;
  }, [isStreamingState, sessionId]);
  useEffect(() => {
    // A "new" session that loses its socket before the first frame (the
    // system/init that assigns its id) never gets a pollable id — that narrow
    // wedge stays unrecovered by design; there is no per-session identity to
    // ask the server about.
    const pollSessionId = isStreamingState ? watchdogIdRef.current : null;
    if (pollSessionId === null) return;
    let ignored = false;
    let idlePolls = 0;
    const poll = () => {
      getChatStatus({ sessionId: pollSessionId })
        .then((status) => {
          if (ignored) return;
          const step = streamWatchdogAdvance({ busy: status.busy, idlePolls });
          idlePolls = step.idlePolls;
          if (step.recover) {
            console.warn("[chatfsm] stream watchdog: server idle while the stream is still open; recovering");
            send({ type: "STREAM_RECOVER" });
          }
        })
        .catch((e: unknown) => {
          console.warn(`[chatfsm] stream watchdog poll failed: ${e instanceof Error ? e.message : String(e)}`);
        });
    };
    const pollId = setInterval(poll, 5000);
    return () => {
      ignored = true;
      clearInterval(pollId);
    };
  }, [isStreamingState, sessionId, send]);
  const value = confirmation?.sessionId === sessionId ? confirmation.value : "unconfirmed";
  return shouldShowAgentWorking({ phase, processBusy, confirmation: value });
}
