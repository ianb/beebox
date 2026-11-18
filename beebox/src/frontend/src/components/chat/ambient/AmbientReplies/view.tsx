/** Mount once above the box composer. Opening a card never selects its source chat. */
import { useEffect, useRef, useState, useCallback } from "react";
import { trpc } from "../../../../lib/trpc/client";
import { useBusSubscription } from "../../../../hooks/useBusSubscription";
import { busEventData } from "../../../../lib/bus-events";
import type { ViewTarget } from "../../../../lib/view-url";
import { readActiveSessions, writeActiveSessions } from "./active-sessions";
import { SessionCallouts } from "./SessionCallouts";
import { CloseButton } from "../../../ui/CloseButton";

// The studio mounts one real session with a supplied transcript, without live subscriptions.
export { SessionCallouts };

export interface AmbientSession { sessionId: string }
export interface AmbientRepliesProps {
  boxSlug: string;
  storageScope: string;
  sessions: AmbientSession[];
  selectedSessionId: string | null;
  transcriptVisible: boolean;
  onInspectCard: (target: ViewTarget) => void;
}

export function AmbientReplies(props: AmbientRepliesProps) {
  const utils = trpc.useUtils();
  const [active, setActive] = useState(() => readActiveSessions(props.storageScope));
  const handleActivity = useCallback((sessionId: string, needed: boolean) => {
    setActive((old) => {
      if (old.includes(sessionId) === needed) return old;
      return needed ? [...old, sessionId] : old.filter((id) => id !== sessionId);
    });
  }, []);
  useEffect(() => { writeActiveSessions(props.storageScope, active); }, [props.storageScope, active]);
  // Sessions whose callouts are on screen; the stack's one dismiss control shows while any are.
  const [showing, setShowing] = useState<string[]>([]);
  const handleShowing = useCallback((sessionId: string, shown: boolean) => {
    setShowing((old) => {
      if (old.includes(sessionId) === shown) return old;
      return shown ? [...old, sessionId] : old.filter((id) => id !== sessionId);
    });
  }, []);
  const [dismissal, setDismissal] = useState(0);
  const [completed, setCompleted] = useState<Record<string, string>>({});
  const sessions = [...new Map(props.sessions.map((session) => [session.sessionId, session])).values()];
  function refresh(sessionId: string) {
    void utils.chat.history.invalidate({ session: sessionId });
    void utils.chat.status.invalidate({ session: sessionId });
  }
  function refreshAll() { for (const session of sessions) { if (session.sessionId === props.selectedSessionId || active.includes(session.sessionId)) refresh(session.sessionId); } }
  useBusSubscription({
    onConnect: refreshAll,
    onEvent(event) {
      const completion = busEventData(event, "chat-complete");
      const history = busEventData(event, "chat-history");
      const user = busEventData(event, "chat-user-message");
      const sessionId = completion?.sessionId ?? history?.sessionId ?? user?.sessionId;
      if (!sessionId || !sessions.some((session) => session.sessionId === sessionId)) return;
      if (completion || user) handleActivity(sessionId, true);
      if (completion) setCompleted((old) => ({ ...old, [sessionId]: completion.timestamp }));
      refresh(sessionId);
    },
  });
  // Refresh on show. The listener is added once and calls the latest refreshAll.
  const refreshAllRef = useRef(refreshAll);
  useEffect(() => { refreshAllRef.current = refreshAll; });
  useEffect(() => {
    function visible() { if (document.visibilityState === "visible") refreshAllRef.current(); }
    document.addEventListener("visibilitychange", visible);
    return () => document.removeEventListener("visibilitychange", visible);
  }, []);
  return (
    <div role="region" aria-label="New callouts" className="relative max-h-72 overflow-y-auto px-2">
      {showing.length > 0 && <CloseButton id="bbx-ambient-dismiss" size="sm" ink label="Dismiss callouts"
        className="absolute top-1 right-1" onClick={() => setDismissal((n) => n + 1)} />}
      <div className={showing.length > 0 ? "pr-8" : undefined}>
        {sessions.filter((session) => session.sessionId === props.selectedSessionId || active.includes(session.sessionId)).map((session) => (
          <SessionCallouts key={`${props.boxSlug}:${session.sessionId}`} {...props} session={session}
            completion={completed[session.sessionId] ?? null} dismissal={dismissal} onActivity={handleActivity} onShowing={handleShowing} />
        ))}
      </div>
    </div>
  );
}
