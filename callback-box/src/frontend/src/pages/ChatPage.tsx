/**
 * ChatPage - entry for the chat route.
 *
 * Reads `?session=<id>` reactively from the URL. Resolves bare `/chat`
 * (no session param) to the box's "most-active" session via
 * `/api/chat/default`, then navigates so subsequent reloads / back nav
 * land on the same id. When neither URL nor server has a session, renders
 * a fresh-chat shell that keys to `"new"`.
 */

import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { InteractiveChat } from "../components/chat/InteractiveChat";
import { getDefaultChatSession } from "../api";
import { href } from "../lib/routing";

interface ChatSearch {
  session?: string;
}

export function ChatPage() {
  const search = useSearch({ strict: false }) as ChatSearch;
  const { boxSlug } = useParams({ strict: false });
  const navigate = useNavigate();
  const sessionParam = search.session;
  const [resolved, setResolved] = useState<string | null>(null);

  // Bare `/chat`: resolve the box's most-active session and navigate to it.
  // If none exists, fall through to a fresh-chat shell.
  useEffect(() => {
    if (sessionParam !== undefined) return;
    let cancelled = false;
    getDefaultChatSession()
      .then(({ sessionId }) => {
        if (cancelled) return;
        if (sessionId) {
          navigate({ to: href(`/${boxSlug}/chat`), search: { session: sessionId } as never, replace: true });
        } else {
          setResolved("new");
        }
      })
      .catch(() => {
        if (!cancelled) setResolved("new");
      });
    return () => {
      cancelled = true;
    };
  }, [sessionParam, boxSlug, navigate]);

  const sessionInput = sessionParam ?? resolved;
  if (sessionInput === null) {
    return <div className="h-full" />;
  }

  // Key on sessionInput so a session switch (or new-chat reset) cleanly
  // remounts the machine and reloads history for the new session.
  return <InteractiveChat key={sessionInput} sessionInput={sessionInput} />;
}
