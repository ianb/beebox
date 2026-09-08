/** Mount once above the box composer. Opening a card never selects its source chat. */
import { useEffect, useState, useCallback } from "react";
import { trpc } from "../../../lib/trpc";
import { useBusSubscription } from "../../../hooks/useBusSubscription";
import { busEventData } from "../../../lib/bus-events";
import type { ViewTarget } from "../../../lib/view-url";
import { readActiveSessions, writeActiveSessions } from "./active-sessions";
import { AmbientSessionReply } from "./AmbientSessionReply";

export interface AmbientSession { sessionId: string; label: string }
export interface AmbientRepliesProps {
  boxSlug: string;
  sessions: AmbientSession[];
  selectedSessionId: string | null;
  transcriptVisible: boolean;
  onOpenConversation: (sessionId: string) => void;
  onInspectCard: (target: ViewTarget) => void;
}

export function AmbientReplies(props: AmbientRepliesProps) {
  const utils = trpc.useUtils();
  const [active, setActive] = useState(() => readActiveSessions(props.boxSlug));
  const handleActivity = useCallback((sessionId: string, needed: boolean) => {
    setActive((old) => {
      if (old.includes(sessionId) === needed) return old;
      return needed ? [...old, sessionId] : old.filter((id) => id !== sessionId);
    });
  }, []);
  useEffect(() => { writeActiveSessions(props.boxSlug, active); }, [props.boxSlug, active]);
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
  useEffect(() => {
    function visible() { if (document.visibilityState === "visible") refreshAll(); }
    document.addEventListener("visibilitychange", visible);
    return () => document.removeEventListener("visibilitychange", visible);
  });
  return (
    <div role="region" className="max-h-72 overflow-y-auto" aria-label="Conversation activity">
      {sessions.filter((session) => session.sessionId === props.selectedSessionId || active.includes(session.sessionId)).map((session) => (
        <AmbientSessionReply key={`${props.boxSlug}:${session.sessionId}`} {...props}
          session={session} completion={completed[session.sessionId] ?? null} onActivity={handleActivity} />
      ))}
    </div>
  );
}
