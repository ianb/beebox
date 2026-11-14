/**
 * The call bar in the chat's status banners (docs/implemented-plans/chat-calls.md,
 * Track D). Reads this tab's call and the chat's call as presence reports
 * it, rings while a call rings here (every few seconds, for up to 20 s), and
 * wires the controls to the call engine.
 */

import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { callEngine } from "../../lib/call/engine";
import { callBarView } from "../../lib/call-state";
import { callRing } from "../../lib/audio/earcons";
import { useCurrentUser } from "../../hooks/useCurrentUser";
import { CallBarFace, type CallBarActions } from "../app-bar-faces/CallBarFace";

const RING_PERIOD_MS = 3000;
const RING_FOR_MS = 20_000;

export function CallBar({ sessionId }: { sessionId: string | null }) {
  const { ui, presence } = useSyncExternalStore(callEngine.subscribe, callEngine.getSnapshot);
  const selfEmail = useCurrentUser()?.email ?? null;
  const view = callBarView({ ui, presence, sessionId, selfEmail });
  const ringingCallId = view.kind === "ringing" ? view.callId : null;
  const rung = useRef<{ callId: string; sinceMs: number } | null>(null);
  useEffect(() => {
    if (ringingCallId === null) return;
    if (rung.current?.callId !== ringingCallId) rung.current = { callId: ringingCallId, sinceMs: Date.now() };
    // A call rings for RING_FOR_MS from when this page first heard it, so a remount only finishes that time.
    const left = RING_FOR_MS - (Date.now() - rung.current.sinceMs);
    if (left <= 0) return;
    // Stops when the call stops ringing here: answered, joined, or ended.
    return callRing.repeatPlay(RING_PERIOD_MS, left);
  }, [ringingCallId]);
  const joinCallId = view.kind === "ringing" || view.kind === "going" ? view.callId : null;
  const actions = useMemo<CallBarActions>(() => ({
    handleJoin: async () => {
      if (sessionId !== null && joinCallId !== null) await callEngine.start(sessionId, joinCallId);
    },
    handleLeave: () => callEngine.leave(),
    handleMute: () => callEngine.toggleMute(),
    handleCamera: () => callEngine.toggleCamera(),
    handleTranscribe: (on) => callEngine.setTranscribing(on),
    handleRetryMic: () => callEngine.retryMic(),
  }), [sessionId, joinCallId]);
  return <CallBarFace view={view} actions={actions} />;
}
