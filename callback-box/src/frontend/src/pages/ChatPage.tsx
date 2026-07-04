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
import { useEmissionStoreInstance } from "../components/chat/input-store";
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
  /**
   * A `view:` URL to open in the companion pane once the chat loads — set by
   * deep-links like the clerk extension's "comment on this page" flow.
   */
  companion?: string;
  /**
   * The card live-open in the companion pane (serialized view URL). Persisted
   * here so a reload restores it; kept in sync by `useCardUrlPersistence`.
   */
  card?: string;
}

export function ChatPage() {
  const search = useSearch({ strict: false }) as ChatSearch;
  const { boxSlug } = useParams({ strict: false });
  const navigate = useNavigate();
  // Created here, above the InteractiveChat remount boundary below, so the
  // in-progress composition (text, images, files, selections) survives a
  // session switch — the design's singleton-draft promise
  // (docs/plans/input-extraction.md, chunk 4). ChatPage itself only remounts
  // on a hard page navigation (route change), not a session switch.
  const emissionStore = useEmissionStoreInstance();
  const sessionParam = search.session;
  const contextDir = search.contextDir;
  const companion = search.companion;
  const card = search.card;
  const [resolved, setResolved] = useState<string | null>(null);

  // Bare `/chat`: resolve the box's most-active session and navigate to it.
  // If none exists, fall through to a fresh-chat shell. Spread the previous
  // search so a live `?card=` (or any other param) survives the redirect —
  // assigning a fresh `{ session }` object would silently drop it.
  useEffect(() => {
    if (sessionParam !== undefined) return;
    let cancelled = false;
    getDefaultChatSession()
      .then(({ sessionId }) => {
        if (cancelled) return;
        if (sessionId) {
          navigate({ to: href(`/${boxSlug}/chat`), search: { ...search, session: sessionId } as never, replace: true });
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
  }, [sessionParam, boxSlug, navigate, search]);

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

  // `sessionInput` can momentarily read null when the router re-evaluates the
  // search params (observed on wake-from-sleep: `?session=` briefly reads
  // undefined before settling back to the same id). Falling through to the
  // empty shell then would unmount InteractiveChat and silently discard the
  // composer's unsent text. Once a real session has been shown, hold onto it
  // (keyState.prev only ever stores non-null ids) so a transient null can't
  // tear down a live chat; the empty shell is reserved for the genuine
  // pre-resolution state where nothing has rendered yet.
  const rendered = sessionInput ?? keyState.prev;
  if (rendered === null) {
    return <div className="h-full" />;
  }

  // contextDir is only meaningful when starting a "new" chat; once the
  // session is assigned, the dir is recorded server-side.
  return (
    <InteractiveChat
      key={keyState.epoch}
      sessionInput={rendered}
      contextDir={rendered === "new" ? contextDir : undefined}
      companion={companion}
      card={card}
      emissionStore={emissionStore}
    />
  );
}
