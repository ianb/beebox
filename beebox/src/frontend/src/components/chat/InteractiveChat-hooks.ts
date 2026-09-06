/**
 * Custom hooks that carve InteractiveChat's state + effects into cohesive
 * units: model/feature selection, schedule polling, and composer
 * attachments. Each follows rules-of-hooks (called unconditionally from the
 * component body in a stable order) and owns its own state slice.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "@tanstack/react-router";
import { getChatHistory, getChatStatus, type SessionEntry } from "../../api";
import { trpcClient } from "../../lib/trpc";
import { chatTailSlice } from "../../machines/chatMachine.js";
import { EMPTY_SIDECAR, sidecarReducer, type SidecarAction, type SidecarState } from "./sidecar-tabs";
import { loadSidecarState, moveSidecarState, saveSidecarState, sidecarTabsKey } from "./sidecar-tabs-storage";
import { usePersistScheduler, PERSIST_DEBOUNCE_MS } from "../../hooks/usePersistScheduler";
import type { OnZoomView } from "./ChatMessages";
import { href, toSearch } from "../../lib/routing";
import { parseViewUrl } from "../../lib/view-url";
import { toastError } from "../ui/toast-store";
import type { ChatSchedule } from "@core/chat/schedules.js";
import type { ChatEvent } from "../../machines/chat-types";

/**
 * Companion-view tab state: opening a view activates an existing tab (keyed by
 * path) or appends a new one; closing falls back to the neighboring tab.
 *
 * The decisions live in `sidecarReducer` (`sidecar-tabs.ts`) — ordering,
 * pinning, eviction — so they are testable apart from React. This hook owns
 * only the wiring: the clock the reducer needs, and the sessionStorage slot
 * that lets the strip survive a reload.
 */
export function useChatTabs({ boxSlug, sessionInput }: { boxSlug: string | undefined; sessionInput: string }) {
  const storageKey = sidecarTabsKey({ boxSlug, sessionInput });
  // Restored during the initializer, not in an effect: a strip that appeared a
  // frame after the first paint would fight `?card=`'s restore for the active
  // tab, and would flash an empty pane on every reload.
  const [panel, setPanel] = useState<SidecarState>(() => loadSidecarState(storageKey) ?? EMPTY_SIDECAR);
  const activeView = panel.activePath
    ? panel.tabs.find((t) => t.target.path === panel.activePath) ?? null
    : null;

  const dispatch = useCallback((action: SidecarAction) => {
    setPanel((state) => sidecarReducer(state, action));
  }, []);

  const onZoomView = useCallback<OnZoomView>((view) => {
    dispatch({ type: "open", target: view.target, label: view.label, at: Date.now() });
  }, [dispatch]);
  const onSelectTab = useCallback((path: string) => {
    dispatch({ type: "select", path, at: Date.now() });
  }, [dispatch]);
  const onCloseTab = useCallback((path: string) => {
    dispatch({ type: "close", path });
  }, [dispatch]);
  const onTogglePin = useCallback((path: string) => {
    dispatch({ type: "togglePin", path, at: Date.now() });
  }, [dispatch]);
  const onClosePanel = useCallback(() => {
    dispatch({ type: "closeAll" });
  }, [dispatch]);

  // Mirrors of the current panel and key for the flush callbacks, which run
  // outside render (a visibility change, an unmount) and must not close over a
  // stale one. Updated in the persist effect below, never during render.
  const panelRef = useRef(panel);
  const keyRef = useRef(storageKey);

  // Debounced through the shared scheduler (400ms), and flushed when the tab
  // hides — the moment a session is most likely to end.
  const { schedule, flush } = usePersistScheduler({
    debounceMs: PERSIST_DEBOUNCE_MS,
    onHide: useCallback((cancel: () => void) => {
      cancel();
      saveSidecarState(keyRef.current, panelRef.current);
    }, []),
  });

  // A chat that started as "new" is assigned its id after the first turn.
  // Carry the strip over rather than stranding it under the placeholder key.
  // Before the panel effect below, so the pending write lands under the key it
  // was scheduled for.
  useEffect(() => {
    const previous = keyRef.current;
    if (previous === storageKey) return;
    keyRef.current = storageKey;
    flush();
    moveSidecarState({ from: previous, to: storageKey });
  }, [storageKey, flush]);

  const restoredRef = useRef(false);
  useEffect(() => {
    // Skip the mount pass: writing back what was just restored is a needless
    // write, and on a fresh chat it would create an empty entry.
    panelRef.current = panel;
    if (!restoredRef.current) {
      restoredRef.current = true;
      return;
    }
    schedule(() => saveSidecarState(storageKey, panelRef.current));
  }, [panel, storageKey, schedule]);

  return { panel, activeView, onZoomView, onSelectTab, onCloseTab, onTogglePin, onClosePanel };
}

/**
 * Open a deep-linked companion doc once on mount. `companion` is a `view:`
 * URL (e.g. the webpage card the clerk extension just captured, passed via
 * the chat route's `?companion=` param). Guarded so a re-render doesn't reopen
 * a tab the user has since closed.
 *
 * After opening, the `?companion=` param is stripped from the URL: it's a
 * one-shot, and the open card is thereafter tracked by `?card=`
 * (useCardUrlPersistence). Leaving it in place meant closing the last tab —
 * which clears `?card=` — still left `?companion=` behind, so a reload
 * re-fired the deep-link and reopened the card. A functional search updater is
 * used so this composes with the `?card=` write without clobbering it.
 */
export function useCompanionDeepLink(opts: {
  companion: string | undefined;
  onZoomView: OnZoomView;
  boxSlug: string | undefined;
}) {
  const { companion, onZoomView, boxSlug } = opts;
  const navigate = useNavigate();
  const openedRef = useRef(false);
  useEffect(() => {
    if (openedRef.current) return;
    if (companion === undefined || companion === "") return;
    openedRef.current = true;
    const target = parseViewUrl(companion);
    onZoomView({ target, label: target.path });
    void navigate({
      to: href(`/${boxSlug}/chat`),
      search: toSearch((prev: Record<string, unknown>) => {
        const next = { ...prev };
        delete next["companion"];
        return next;
      }),
      replace: true,
    });
  }, [companion, onZoomView, navigate, boxSlug]);
}

interface ChatSendFn {
  (event: { type: "SET_MESSAGES"; messages: SessionEntry[]; sessionId: string | null }): void;
}

/**
 * Mute toggle persisted to localStorage (key `chat-muted`). SSR-safe initial
 * read.
 */
export function useChatMute() {
  const [muted, setMuted] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      return localStorage.getItem("chat-muted") === "1";
    } catch (_e) {
      return false;
    }
  });
  const handleToggleMute = useCallback(() => {
    setMuted((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("chat-muted", next ? "1" : "0");
      } catch (_e) {
        // storage unavailable
      }
      return next;
    });
  }, []);
  return { muted, handleToggleMute };
}

/**
 * Active chat schedules: polled on mount + after each turn, with a 3s
 * fallback poll for fired schedules (covers missed SSE) and a cancel action.
 */
export function useChatSchedules(opts: {
  messages: SessionEntry[];
  /** False while the chat machine is still loading — `messages` isn't the transcript yet. */
  loaded: boolean;
  isStreaming: boolean;
  send: ChatSendFn;
}) {
  const { messages, loaded } = opts;
  const [activeSchedules, setActiveSchedules] = useState<ChatSchedule[]>([]);

  const fetchSchedules = useCallback(() => {
    trpcClient.chat.schedules.query()
      .then((data) => {
        setActiveSchedules(data.schedules);
      })
      .catch((e: unknown) => {
        console.warn(`[chatfsm] fetch-schedules failed: ${e instanceof Error ? e.message : String(e)}`);
      });
  }, []);

  // Fetch on mount, and whenever a NEW entry lands. Keyed on the newest entry's
  // uuid, not the array: `messages` gets a fresh identity on every history
  // fetch (initial load, refresh, server push), which refired this on every one
  // of them — a duplicate request moments after mount. Schedules are set by
  // `<schedule>` tags the agent writes, which can only reach the transcript as
  // a new entry, so a re-read that ends on the same entry can't change them.
  // (The count would miss the case that matters most for a long chat: at the
  // HISTORY_TAIL cap, a new turn pushes the oldest entry out and the length
  // never moves.)
  //
  // Skipped while the machine loads: `messages` is the empty pre-load array
  // then, and fetching on it only to fetch again a tick later when the
  // transcript lands is the second half of the same duplicate.
  const newestUuid = messages.at(-1)?.uuid ?? null;
  useEffect(() => {
    if (!loaded) return;
    fetchSchedules();
  }, [loaded, newestUuid, fetchSchedules]);

  // NOTE: a former "poll /chat/history after a schedule fires" fallback lived
  // here but was inert — it fetched history with no session id, which the
  // endpoint rejected, so it never refreshed anything. Schedule-fired turns
  // arrive over the WS event stream (events.subscribe); the fallback is dropped
  // rather than ported.

  const handleCancelSchedule = useCallback((label: string) => {
    // User-initiated action (rule 5): surface a failed cancel via the toast
    // channel -- otherwise the schedule pill stays, but the user has no signal
    // that their cancel didn't take.
    trpcClient.chat.cancelSchedule.mutate({ label })
      .then(() => fetchSchedules())
      .catch((e: unknown) => {
        console.error(`[chatfsm] cancel-schedule "${label}" failed: ${e instanceof Error ? e.message : String(e)}`);
        toastError(`Failed to cancel the "${label}" schedule`, { cause: e });
      });
  }, [fetchSchedules]);

  return { activeSchedules, fetchSchedules, handleCancelSchedule };
}

/**
 * Poll history every 5s while pending messages exist, as a fallback for a
 * missed chat-complete SSE — SET_MESSAGES reconcile drops them as the server
 * catches up.
 */
export function usePendingMessagePoll(opts: {
  pendingCount: number;
  sessionId: string | null;
  send: ChatSendFn;
}) {
  const { pendingCount, sessionId, send } = opts;
  useEffect(() => {
    if (pendingCount === 0) return;
    if (!sessionId) return;
    const poll = () => {
      getChatHistory({ sessionId, slice: chatTailSlice() })
        .then((data) => {
          send({ type: "SET_MESSAGES", messages: data.entries, sessionId: data.sessionId });
        })
        .catch((e: unknown) => {
          // Poll retries on its own timer, but retry-resilience and
          // observability are different properties (policy rule 4) -- log
          // even though a dead backend would otherwise just look like a
          // frozen UI.
          console.warn(`[chatfsm] pending-message poll failed: ${e instanceof Error ? e.message : String(e)}`);
        });
    };
    const id = setInterval(poll, 5000);
    return () => clearInterval(id);
  }, [pendingCount, send, sessionId]);
}

/**
 * Recover a stalled stream when the tab is brought back to the foreground.
 *
 * The per-turn POST stream can have its connection dropped while the tab is
 * backgrounded and never deliver a terminal event, wedging the machine in
 * `streaming` — where REFRESH (the normal chat-complete recovery) is
 * deliberately ignored. useProcessingStatusPoll is also gated off during
 * streaming, so nothing pulls the finished reply until a manual reload.
 *
 * On return to visible, if we're still in `streaming`, ask the server whether
 * the turn actually finished; if so, dispatch STREAM_RECOVER (a silent
 * STREAM_FAILED — sent only once the server confirms done, so no STREAM_RESULT
 * is left to race) to fall through to a history refresh.
 */
export function useChatStallRecovery(opts: {
  /** snapshot.matches("streaming") — not "refreshing", which self-resolves. */
  isStreamingState: boolean;
  sessionId: string | null;
  send: (event: ChatEvent) => void;
}) {
  const { isStreamingState, sessionId, send } = opts;
  // Read latest state at event time; the listener mounts once (send is stable).
  const stateRef = useRef({ isStreamingState, sessionId });
  useEffect(() => {
    stateRef.current = { isStreamingState, sessionId };
  });
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      const current = stateRef.current;
      if (!current.isStreamingState || !current.sessionId) return;
      getChatStatus({ sessionId: current.sessionId })
        .then((status) => {
          if (!status.busy) send({ type: "STREAM_RECOVER" });
        })
        .catch((e: unknown) => {
          console.warn(`[chatfsm] stall-recovery status check failed: ${e instanceof Error ? e.message : String(e)}`);
        });
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [send]);
}
