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
  /**
   * When starting a new chat from a landmark, this is the directory the
   * chat is bound to. Forwarded to the backend on the first send; the SDK
   * is spawned with `cwd` at that directory and the association is
   * persisted to chat-session-history.
   */
  contextDir?: string;
}

export function ChatPage() {
  const search = useSearch({ strict: false }) as ChatSearch;
  const { boxSlug } = useParams({ strict: false });
  const navigate = useNavigate();
  const sessionParam = search.session;
  const contextDir = search.contextDir;
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

  // Key InteractiveChat so a real session switch (or "new chat" reset)
  // remounts the machine and reloads history. The `"new" → assigned id`
  // transition is the *same* logical session getting its real id mid-stream;
  // remounting then would orphan the live SSE listener and the user would
  // see an empty chat until reload. We keep the key stable across that one
  // transition and let InteractiveChat update the running machine in place.
  const [keyState, setKeyState] = useState<{ epoch: number; prev: string | null }>({ epoch: 0, prev: null });
  if (sessionInput !== null && sessionInput !== keyState.prev) {
    const isNewResolution = keyState.prev === "new" && sessionInput !== "new";
    setKeyState({
      epoch: isNewResolution ? keyState.epoch : keyState.epoch + 1,
      prev: sessionInput,
    });
  }

  if (sessionInput === null) {
    return <div className="h-full" />;
  }

  // contextDir is only meaningful when starting a "new" chat; once the
  // session is assigned, the dir is recorded server-side.
  return (
    <InteractiveChat
      key={keyState.epoch}
      sessionInput={sessionInput}
      contextDir={sessionInput === "new" ? contextDir : undefined}
    />
  );
}
