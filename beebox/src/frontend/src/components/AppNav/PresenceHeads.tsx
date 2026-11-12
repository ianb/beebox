/**
 * Who else has this chat open, under the profile avatar (docs/chat-presence.md).
 *
 * Being subscribed to `chatPresence.watch` is being present, so this
 * subscribes only while the person is in the chat: it is the current
 * conversation, its transcript is on screen, and the page is active. In a
 * browser, active is visible and focused; in the iOS web view, visible, since
 * the native composer takes DOM focus from the page while the person types.
 */

import { useCallback, useEffect, useState } from "react";
import { trpc } from "../../lib/trpc/client";
import { useBoxConversation } from "../chat/everywhere/conversation-context/context";
import { useWorkspace } from "../chat/workspace/WorkspaceProvider/provider";
import { isNativeShell } from "../chat/native-post";
import { PresenceHeadsFace, type PresenceHead } from "../app-bar-faces/PresenceHeadsFace";

const NO_ONE: readonly PresenceHead[] = [];

function pageActive(): boolean {
  if (document.visibilityState !== "visible") return false;
  return isNativeShell() || document.hasFocus();
}

/** Whether the person is looking at this page now; see the module comment. */
function usePageActive(): boolean {
  const [active, setActive] = useState(pageActive);
  useEffect(() => {
    const update = () => setActive(pageActive());
    document.addEventListener("visibilitychange", update);
    window.addEventListener("focus", update);
    window.addEventListener("blur", update);
    return () => {
      document.removeEventListener("visibilitychange", update);
      window.removeEventListener("focus", update);
      window.removeEventListener("blur", update);
    };
  }, []);
  return active;
}

/** The other people present in `sessionId`, or none while not watching it. */
function useChatPresence(sessionId: string | null, watching: boolean): readonly PresenceHead[] {
  const [people, setPeople] = useState<readonly PresenceHead[]>(NO_ONE);
  const sub = trpc.chatPresence.watch.useSubscription(
    { sessionId: sessionId ?? "" },
    {
      enabled: watching && sessionId !== null,
      // A new or restarted subscription starts from nobody until its first frame.
      onStarted: useCallback(() => setPeople(NO_ONE), []),
      onData: useCallback((frame: { t: "others"; people: PresenceHead[] }) => setPeople(frame.people), []),
      onError: useCallback((err: { message: string }) => {
        // wsLink reconnects on its own; with no live subscription no heads show.
        console.warn(`[chat-presence] ${err.message}`);
      }, []),
    },
  );
  // Only a live subscription's list is current: while the WebSocket reconnects
  // the people it last reported may have left.
  return sub.status === "pending" ? people : NO_ONE;
}

export function PresenceHeads() {
  const conversation = useBoxConversation();
  const workspace = useWorkspace();
  const active = usePageActive();
  const target = conversation?.rendered?.target;
  const sessionId = target?.kind === "session" && conversation?.unstarted !== true ? target.sessionId : null;
  const transcriptVisible = workspace?.transcriptVisible === true;
  const people = useChatPresence(sessionId, active && transcriptVisible);
  return <PresenceHeadsFace people={people} />;
}
