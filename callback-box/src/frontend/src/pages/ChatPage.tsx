/**
 * ChatPage - entry for the chat route.
 *
 * Reads `?session=<id>` reactively from the URL. One `chat.bootstrap` query
 * covers the whole mount: it resolves bare `/chat` to the box's "most-active"
 * session AND returns that session's history + status, which are handed to
 * `InteractiveChat` so the chat machine's initial load doesn't ask again.
 * The URL is then rewritten with the resolved id so reloads / back nav land on
 * the same session. When neither URL nor server has a session, renders a
 * fresh-chat shell that keys to `"new"`.
 */

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { InteractiveChat } from "../components/chat/InteractiveChat";
import { ChatLoading } from "../components/chat/InteractiveChat-layout";
import { useEmissionStoreInstance } from "../components/chat/input-store";
import { isNativeShell } from "../components/chat/native-post";
import { trpc, type RouterOutput } from "../lib/trpc";
import { chatTailSlice, type ChatInitialLoad } from "../machines/chat-types";
import { href, toSearch } from "../lib/routing";
import { carriesFreshChatMachine, createSessionAssignmentLatch } from "./chat-session-transition";
import { UnavailableChat } from "../components/chat-delete/UnavailableChat";
import { useIdlePrefetch } from "../hooks/useIdlePrefetch";

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
  /**
   * Keep the normal web navigation and chat header, but leave message input to
   * the native shell.
   */
  nativeComposer?: string | number;
  /**
   * Open capture mode on load — the `/capture` deep link redirects here with
   * this set. Consumed once by InteractiveChat's initial state.
   */
  capture?: string | number;
}

/**
 * Map a settled `chat.bootstrap` result onto the chat machine's preloaded
 * initial load — or `undefined` when it doesn't describe the session being
 * rendered, in which case the machine falls back to fetching for itself.
 */
function initialLoadFrom(params: {
  rendered: string;
  data: RouterOutput["chat"]["bootstrap"] | undefined;
  /** The query's error, structurally — a tRPC client error is not an `Error` subclass. */
  error: { message: string } | null;
}): ChatInitialLoad | undefined {
  const { rendered, data, error } = params;
  // A fresh chat has nothing to load, and no bootstrap query ran for it.
  if (rendered === "new") return undefined;
  // Reproduce the failure inside the machine so a failed preload surfaces the
  // same way a failed in-machine fetch does (error banner, chat still usable).
  if (error) return { status: "failed", error: error.message };
  if (!data || data.sessionId !== rendered || data.history === null) return undefined;
  return {
    status: "loaded",
    entries: data.history.entries,
    total: data.history.total,
    sessionId: data.history.sessionId,
    running: data.status.running,
    busy: data.status.busy,
  };
}

/**
 * The session chip's name for the session actually rendered.
 *
 * `chat.bootstrap` carries the label for the session it answered for, but it
 * never runs for a chat that started as `?session=new`, and it stays disabled
 * once that machine is *carried* onto its assigned id (see `keyState.carried`)
 * — so the chip would read as unnamed until a reload. The narrow fix is to
 * fetch only the label for the assigned id: that's a husk read, not the
 * transcript the running machine owns, so the page's no-refetch-during-a-turn
 * rule is untouched.
 */
function useSessionLabel({
  rendered,
  carried,
  bootstrapped,
}: {
  rendered: string | null;
  carried: boolean;
  bootstrapped: RouterOutput["chat"]["bootstrap"] | undefined;
}): string | null {
  const assigned = carried && rendered !== null && rendered !== "new" ? rendered : null;
  const query = trpc.chat.label.useQuery({ session: assigned ?? "" }, { enabled: assigned !== null, refetchOnWindowFocus: false });
  if (bootstrapped !== undefined && bootstrapped.sessionId === rendered) return bootstrapped.label;
  return query.data === undefined ? null : query.data.label;
}

export function ChatPage() {
  // eslint-disable-next-line no-restricted-syntax -- router boundary: `useSearch({ strict: false })` returns the union of every route's search params (this page mounts under a non-strict route), so it can't be statically typed to this page's ChatSearch shape without the cast.
  const search = useSearch({ strict: false }) as ChatSearch;
  const { boxSlug } = useParams({ strict: false });
  const navigate = useNavigate();
  // Created here, above the InteractiveChat remount boundary below, so the
  // in-progress composition (text, images, files, selections) survives a
  // session switch — the design's singleton-draft promise
  // (docs/implemented-plans/input-extraction.md, chunk 4). ChatPage itself only remounts
  // on a hard page navigation (route change), not a session switch.
  const emissionStore = useEmissionStoreInstance(boxSlug);
  const sessionParam = search.session;
  const contextDir = search.contextDir;
  const companion = search.companion;
  const card = search.card;
  // The `?nativeComposer=1` param only rides the initial chat URL; after an
  // in-app navigation it's gone, which un-suppressed the web composer under the
  // native one. Detect the native shell by its always-present bridge instead, so
  // the flag survives navigation. The param stays as a fast-path / legacy signal.
  const nativeComposer = String(search.nativeComposer) === "1" || isNativeShell();
  const openCaptureOnMount = String(search.capture) === "1";

  // Key InteractiveChat so a real session switch (or "new chat" reset)
  // remounts the machine and reloads history. The `"new" → assigned id`
  // transition is the *same* logical session getting its real id mid-stream;
  // remounting then would orphan the live SSE listener and the user would
  // see an empty chat until reload. We keep the key stable across that one
  // transition and let InteractiveChat update the running machine in place.
  //
  // Two flags ride along, both about that transition and both read BEFORE the
  // query below (hence the early declaration):
  //  - `carried`: this key's machine is already running (it mounted as "new"
  //    and just learned its id). It holds the transcript, so bootstrapping the
  //    assigned id would fetch a history nobody reads.
  //  - `awaiting`: a NEW machine is about to mount with no data yet — the one
  //    case that must show a skeleton rather than mount and let the machine
  //    fetch (that fetch is the round trip bootstrap exists to remove).
  const [keyState, setKeyState] = useState<{
    epoch: number;
    prev: string | null;
    carried: boolean;
    awaiting: boolean;
  }>({
    epoch: 0,
    prev: null,
    carried: false,
    awaiting: false,
  });
  // InteractiveChat announces a real backend assignment immediately before
  // it rewrites `?session=new` to the assigned id. Without this handshake,
  // an explicit landmark/session navigation from a fresh chat is
  // indistinguishable from assignment and the blank machine is incorrectly
  // carried onto the existing session instead of loading its transcript.
  //
  // An external-store latch, NOT state — see SessionAssignmentLatch for why
  // (the URL rewrite renders at sync priority, before a same-tick setState).
  const assignmentLatch = useMemo(() => createSessionAssignmentLatch(), []);
  const announcedAssignment = useSyncExternalStore(assignmentLatch.subscribe, assignmentLatch.get);
  const announceSessionAssignment = useCallback((sessionId: string) => {
    assignmentLatch.announce(sessionId);
  }, [assignmentLatch]);
  // One announcement guards exactly one key transition: once a transition
  // commits (prev changed — whether it consumed the announcement or not), a
  // later explicit navigation must not inherit it.
  useEffect(() => {
    assignmentLatch.clear();
  }, [keyState.prev, assignmentLatch]);

  // The one mount-time round trip. With `session` omitted the server resolves
  // the box's most-active session and answers for it; `?session=new` is a
  // client-side sentinel rather than a session id, so no query runs for it.
  const isFreshChat = sessionParam === "new";
  const bootstrap = trpc.chat.bootstrap.useQuery(
    {
      slice: chatTailSlice(),
      ...(sessionParam !== undefined ? { session: sessionParam } : {}),
    },
    {
      enabled: !isFreshChat && !keyState.carried,
      // Mount-time data. A focus refetch would land after the machine has taken
      // ownership of the transcript (it keeps itself current over the WS), so
      // it would cost a full history read and change nothing.
      refetchOnWindowFocus: false,
    },
  );
  // `isFetching` matters: react-query hands back CACHED data for a key it is
  // about to refetch, and the machine reads its preload exactly once. Mounting
  // on a stale cache entry would show an old transcript that the completed
  // refetch could no longer correct.
  const settled = isFreshChat || keyState.carried || ((bootstrap.data !== undefined || bootstrap.isError) && !bootstrap.isFetching);

  // Bare `/chat`: adopt whatever the server resolved. A failed bootstrap falls
  // through to the fresh-chat shell, as the old default-session lookup did.
  //
  // Only the FIRST resolution adopts it (`prev === null`), or a later one that
  // names the session already showing. Two ways that matters: a transient
  // `?session=` blip (see below) would otherwise swap a live chat for the
  // default one, and a bare-`/chat` bootstrap that failed into the "new" shell
  // would otherwise, on a later success, "carry" that never-assigned machine
  // onto a real session id.
  const resolvedDefault = ((): string | null => {
    if (sessionParam !== undefined) return null;
    const candidate = bootstrap.data ? (bootstrap.data.sessionId ?? "new") : bootstrap.isError ? "new" : null;
    if (candidate === null) return null;
    return keyState.prev === null || keyState.prev === candidate ? candidate : null;
  })();

  // Bare `/chat` that resolved to a real session: put the id in the URL so a
  // reload / back nav lands on the same one. The chat itself already rendered
  // from `resolvedDefault` — this navigation costs no round trip. Spread the
  // previous search so a live `?card=` (or any other param) survives it.
  const utils = trpc.useUtils();

  // Warm the app bar's place-switch menu once this page is interactive. Its
  // `chat.placeMenu` query stays lazy (PlacePill's header explains why a bar
  // that mounts everywhere must not carry it at rest) — but "lazy" made the
  // first open after every page load sit on "Loading…". Gating on `settled`,
  // and running from idle time, is what keeps this off the critical path: the
  // chat's own readiness never waits on it.
  // `gcTime` is the whole point of prefetching rather than hoping: react-query
  // collects an unobserved entry after 5 minutes by default, and the menu has
  // no observer until it is first opened — so a default-lifetime warm-up would
  // expire before a user who reads for a while ever clicks. Freshness is
  // unaffected: the first open still refetches in the background (the entry is
  // stale by then), and every later open invalidates.
  useIdlePrefetch(() => utils.chat.placeMenu.prefetch(undefined, { gcTime: 60 * 60 * 1000 }), {
    enabled: settled,
  });

  useEffect(() => {
    if (sessionParam !== undefined) return;
    const data = bootstrap.data;
    const resolvedId = data ? data.sessionId : null;
    if (!data || !resolvedId) return;
    // Never navigate a chat that's already showing onto a different session:
    // the same guard `resolvedDefault` applies, for the same transient-blip and
    // failed-then-succeeded cases.
    if (keyState.prev !== null && keyState.prev !== resolvedId) return;
    // Seed the explicit-session query with the answer we already have. The
    // navigation below changes this page's query input from "default session"
    // to `session=<id>`, which is a different cache key — without the seed,
    // react-query would fetch the very same bootstrap a second time.
    utils.chat.bootstrap.setData({ slice: chatTailSlice(), session: resolvedId }, data);
    // navigate()'s promise only rejects on a superseded/redirected
    // navigation (not a user-facing failure) -- fire-and-forget.
    void navigate({
      to: href(`/${boxSlug}/chat`),
      search: toSearch({ ...search, session: resolvedId }),
      replace: true,
    });
  }, [sessionParam, bootstrap.data, boxSlug, navigate, search, utils.chat.bootstrap, keyState.prev]);

  const sessionInput = sessionParam ?? resolvedDefault;

  if (sessionInput !== null && sessionInput !== keyState.prev) {
    const isNewResolution = carriesFreshChatMachine({
      previousSessionInput: keyState.prev,
      nextSessionInput: sessionInput,
      announcedAssignment,
    });
    setKeyState({
      epoch: isNewResolution ? keyState.epoch : keyState.epoch + 1,
      prev: sessionInput,
      carried: isNewResolution,
      awaiting: !isNewResolution && !settled,
    });
  } else if (keyState.awaiting && settled) {
    setKeyState({ ...keyState, awaiting: false });
  }

  // `sessionInput` can momentarily read null when the router re-evaluates the
  // search params (observed on wake-from-sleep: `?session=` briefly reads
  // undefined before settling back to the same id). Falling through to the
  // empty shell then would unmount InteractiveChat and silently discard the
  // composer's unsent text. Once a real session has been shown, hold onto it
  // (keyState.prev only ever stores non-null ids) so a transient null can't
  // tear down a live chat; the skeleton is reserved for the genuine
  // pre-resolution state where nothing has rendered yet.
  const rendered = sessionInput ?? keyState.prev;
  const sessionLabel = useSessionLabel({
    rendered,
    carried: keyState.carried,
    bootstrapped: bootstrap.data,
  });

  if (rendered === null || keyState.awaiting) {
    return <ChatLoading />;
  }

  const unavailable = bootstrap.data?.kind === "unavailable" && bootstrap.data.sessionId === rendered ? bootstrap.data : null;
  if (unavailable !== null) {
    return <UnavailableChat boxSlug={boxSlug} sessionId={unavailable.sessionId} label={unavailable.label} huskPath={unavailable.huskPath} />;
  }

  // contextDir is only meaningful when starting a "new" chat; once the
  // session is assigned, the dir is recorded server-side.
  return (
    <InteractiveChat
      key={keyState.epoch}
      sessionInput={rendered}
      initial={initialLoadFrom({
        rendered,
        data: bootstrap.data,
        error: bootstrap.error,
      })}
      contextDir={rendered === "new" ? contextDir : undefined}
      companion={companion}
      card={card}
      emissionStore={emissionStore}
      sessionLabel={sessionLabel}
      onSessionAssignment={announceSessionAssignment}
      nativeComposer={nativeComposer}
      openCaptureOnMount={openCaptureOnMount}
    />
  );
}
