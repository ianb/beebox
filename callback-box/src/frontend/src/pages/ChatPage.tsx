/**
 * ChatPage - entry for the chat route.
 *
 * When `?session=<id>` is present in the URL, renders a read-only
 * SessionViewer. Otherwise delegates to InteractiveChat for the live
 * chat UI.
 */

import { SessionViewer } from "../components/SessionViewer";
import { InteractiveChat } from "../components/chat/InteractiveChat";

export function ChatPage() {
  const viewSessionId = new URLSearchParams(window.location.search).get("session");

  if (viewSessionId) {
    return <SessionViewer sessionId={viewSessionId} />;
  }

  return <InteractiveChat />;
}
