/**
 * The call bar in the chat's status banners (docs/plans/chat-calls.md,
 * Track D). Reads this tab's call and the chat's call as presence reports
 * it, chimes once when a call starts ringing here, and wires the controls to
 * the call engine.
 */

import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { callEngine } from "../../lib/call/engine";
import { callBarView } from "../../lib/call-state";
import { callRing } from "../../lib/audio/earcons";
import { useCurrentUser } from "../../hooks/useCurrentUser";
import { CallBarFace, type CallBarActions } from "../app-bar-faces/CallBarFace";

export function CallBar({ sessionId }: { sessionId: string | null }) {
  const { ui, presence } = useSyncExternalStore(callEngine.subscribe, callEngine.getSnapshot);
  const selfEmail = useCurrentUser()?.email ?? null;
  const view = callBarView({ ui, presence, sessionId, selfEmail });
  const ringingCallId = view.kind === "ringing" ? view.callId : null;
  const chimed = useRef<string | null>(null);
  useEffect(() => {
    if (ringingCallId === null || chimed.current === ringingCallId) return;
    chimed.current = ringingCallId;
    callRing.play();
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
