/**
 * Custom hooks that carve InteractiveChat's state + effects into cohesive
 * units: model/feature selection, schedule polling, and composer
 * attachments. Each follows rules-of-hooks (called unconditionally from the
 * component body in a stable order) and owns its own state slice.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "@tanstack/react-router";
import { getChatHistory, getChatStatus, setChatModel, getChatFeatures, setChatFeature, type SessionEntry } from "../../api";
import { trpcClient } from "../../lib/trpc";
import { chatTailSlice } from "../../machines/chatMachine.js";
import { type ModelMarker } from "./InteractiveChat-helpers";
import { chatModelOptions, type ChatAgentEngine } from "@shared/chat-models.js";
import type { PanelTab } from "./InteractiveChat-controls";
import type { OnZoomView } from "./ChatMessages";
import { href, toSearch } from "../../lib/routing";
import { parseViewUrl, serializeViewUrl } from "../../lib/view-url";
import { toastError } from "../ui/toast-store";
import type { ChatSchedule } from "@core/chat/schedules.js";
import type { ChatEvent } from "../../machines/chat-types";

/**
 * Companion-view tab state: opening a view activates an existing tab (keyed
 * by path) or appends a new one; closing falls back to the neighboring tab.
 */
export function useChatTabs() {
  const [panel, setPanel] = useState<{ tabs: PanelTab[]; activePath: string | null }>({ tabs: [], activePath: null });
  const activeView = panel.activePath
    ? panel.tabs.find((t) => t.target.path === panel.activePath) ?? null
    : null;

  const onZoomView = useCallback<OnZoomView>((view) => {
    setPanel((p) => {
      // One tab per card path. Re-opening the same card with a different
      // viewer/params refreshes the existing tab's target in place (so
      // `?view=` actually switches) rather than colliding silently.
      const idx = p.tabs.findIndex((t) => t.target.path === view.target.path);
      const existing = idx === -1 ? undefined : p.tabs[idx];
      const key = serializeViewUrl(view.target);
      const tabs =
        existing === undefined
          ? [...p.tabs, view]
          : serializeViewUrl(existing.target) === key
          ? p.tabs
          : p.tabs.map((t, i) => (i === idx ? view : t));
      return { tabs, activePath: view.target.path };
    });
  }, []);
  const onSelectTab = useCallback((path: string) => {
    setPanel((p) => ({ ...p, activePath: path }));
  }, []);
  const onCloseTab = useCallback((path: string) => {
    setPanel((p) => {
      const idx = p.tabs.findIndex((t) => t.target.path === path);
      if (idx === -1) return p;
      const tabs = p.tabs.filter((_, i) => i !== idx);
      const activePath = p.activePath === path
        ? (tabs.length === 0 ? null : (tabs[Math.min(idx, tabs.length - 1)]?.target.path ?? null))
        : p.activePath;
      return { tabs, activePath };
    });
  }, []);
  const onClosePanel = useCallback(() => {
    setPanel({ tabs: [], activePath: null });
  }, []);

  return { panel, activeView, onZoomView, onSelectTab, onCloseTab, onClosePanel };
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
 * Persisted model selection + chat-feature flags (narration, prose, …), with
 * the ephemeral model-switch markers shown in the stream. Server state is
 * read on mount; feature changes are optimistic and reconciled by the SSE
 * `chat-features-changed` handler in the parent.
 */
export function useChatModelFeatures(opts: { sessionId: string | null; groupCount: number; send: (event: ChatEvent) => void }) {
  const { sessionId, groupCount, send } = opts;
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [agentEngine, setAgentEngine] = useState<ChatAgentEngine | null>(null);
  const [modelMarkers, setModelMarkers] = useState<ModelMarker[]>([]);
  const [chatFeatures, setChatFeatures] = useState<Record<string, string>>({});

  // Read the session's engine and per-session model override. For a fresh
  // chat, status reports the box's configured engine and no override.
  useEffect(() => {
    let current = true;
    setAgentEngine(null);
    getChatStatus({ sessionId })
      .then((status) => {
        if (!current) return;
        setSelectedModel(status.model);
        setAgentEngine(status.engine);
      })
      .catch((e: unknown) => {
        console.warn(`[chatfsm] get-status (model) failed: ${e instanceof Error ? e.message : String(e)}`);
      });
    return () => { current = false; };
  }, [sessionId]);

  // Chat-feature flags synced via /api/chat/features on mount, then kept
  // fresh through chat-features-changed events on the global SSE stream.
  useEffect(() => {
    if (!sessionId) return;
    getChatFeatures({ sessionId })
      .then((res) => { setChatFeatures(res.features); })
      .catch((e: unknown) => {
        console.warn(`[chatfsm] get-features failed: ${e instanceof Error ? e.message : String(e)}`);
      });
  }, [sessionId]);

  const narrationEnabled = chatFeatures.narration === "on";

  // Generation counters so an out-of-order completion (an older toggle/select
  // resolving after a newer one) can't clobber state a later request already
  // set — bumped on every call, and a response only applies if it's still the
  // most recent one in flight.
  const narrationRequestIdRef = useRef(0);
  const modelRequestIdRef = useRef(0);

  const handleToggleNarration = useCallback(() => {
    const next = narrationEnabled ? "off" : "on";
    // Rollback target if the request is rejected — the pre-toggle value,
    // derived the same way `narrationEnabled` is (absent key reads as "off").
    const previous = narrationEnabled ? "on" : "off";
    const requestId = ++narrationRequestIdRef.current;
    // Optimistic — server-confirmed value lands via the SSE event handler
    // (or, pre-session, reconciles from the server once the id is assigned).
    setChatFeatures((prev) => ({ ...prev, narration: next }));
    if (!sessionId) {
      // Brand-new chat: no session to set the flag on yet. Stash the choice
      // as a machine seed so it rides along on the first send and applies to
      // the very first turn.
      send({ type: "SET_SEED_FEATURE", feature: "narration", value: next });
      return;
    }
    setChatFeature({ sessionId, feature: "narration", value: next })
      .then((res) => {
        if (narrationRequestIdRef.current !== requestId) return;
        setChatFeatures(res.features);
      })
      .catch((e: unknown) => {
        console.warn(`[chatfsm] set-feature narration failed: ${e instanceof Error ? e.message : String(e)}`);
        toastError("Failed to update narration mode", { cause: e });
        if (narrationRequestIdRef.current !== requestId) return;
        // No SSE correction follows a rejected write, so the optimistic flip
        // must be undone here or the UI shows wrong state indefinitely — but
        // only when no newer toggle has since taken over.
        setChatFeatures((prev) => ({ ...prev, narration: previous }));
      });
  }, [sessionId, narrationEnabled, send]);

  const handleSelectModel = useCallback((model: string | null) => {
    if (model === selectedModel) return;
    const previous = selectedModel;
    if (agentEngine === null) return;
    const label = chatModelOptions(agentEngine).find((o) => o.model === model)?.label ?? "default";
    const markerId = `model-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const requestId = ++modelRequestIdRef.current;
    setModelMarkers((markers) => [
      ...markers,
      { id: markerId, label: `Switched to ${label}`, afterGroupCount: groupCount },
    ]);
    setSelectedModel(model);
    if (sessionId) {
      console.debug(`[chatfsm] set-model request sessionId=${sessionId} model=${model ?? "<default>"}`);
      setChatModel({ sessionId, model })
        .then((res) => {
          console.debug(`[chatfsm] set-model response model=${res.model ?? "<default>"} ok=${res.ok}`);
          if (modelRequestIdRef.current !== requestId) return;
          // Re-sync UI to whatever the server actually persisted, in case a
          // race / bug means the request landed differently than expected.
          setSelectedModel(res.model);
        })
        .catch((e: unknown) => {
          const msg = e instanceof Error ? e.message : String(e);
          console.warn(`[chatfsm] set-model error: ${msg}`);
          toastError("Failed to switch model", { cause: e });
          setModelMarkers((markers) => markers.filter((m) => m.id !== markerId));
          if (modelRequestIdRef.current !== requestId) return;
          // Roll back the optimistic selection — but only when no newer
          // selection has since taken over, so a stale rejection can't
          // clobber a selection made after it.
          setSelectedModel(previous);
        });
    } else {
      console.debug("[chatfsm] set-model skipped — sessionId is null");
    }
  }, [selectedModel, groupCount, sessionId, agentEngine]);

  return { agentEngine, selectedModel, modelMarkers, chatFeatures, setChatFeatures, narrationEnabled, handleToggleNarration, handleSelectModel };
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
