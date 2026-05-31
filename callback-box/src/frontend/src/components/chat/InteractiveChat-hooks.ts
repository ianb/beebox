/**
 * Custom hooks that carve InteractiveChat's state + effects into cohesive
 * units: model/feature selection, schedule polling, and composer
 * attachments. Each follows rules-of-hooks (called unconditionally from the
 * component body in a stable order) and owns its own state slice.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { getApiBase, getChatHistory, getChatStatus, setChatModel, getChatFeatures, setChatFeature, type SessionEntry } from "../../api";
import { HISTORY_TAIL, MIN_REAL_USER_MESSAGES } from "../../machines/chatMachine.js";
import { MODEL_OPTIONS, type ModelMarker } from "./InteractiveChat-helpers";
import type { PanelTab } from "./InteractiveChat-controls";
import type { OnZoomView } from "../ChatMessages";
import type { ChatSchedule } from "../../../../core/chat-schedules";

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
      const exists = p.tabs.some((t) => t.target.path === view.target.path);
      const tabs = exists ? p.tabs : [...p.tabs, view];
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
        ? (tabs.length === 0 ? null : tabs[Math.min(idx, tabs.length - 1)].target.path)
        : p.activePath;
      return { tabs, activePath };
    });
  }, []);
  const onClosePanel = useCallback(() => {
    setPanel({ tabs: [], activePath: null });
  }, []);

  return { panel, activeView, onZoomView, onSelectTab, onCloseTab, onClosePanel };
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
export function useChatModelFeatures(opts: { sessionId: string | null; groupCount: number }) {
  const { sessionId, groupCount } = opts;
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [modelMarkers, setModelMarkers] = useState<ModelMarker[]>([]);
  const [chatFeatures, setChatFeatures] = useState<Record<string, string>>({});

  // Server persists the selection in .callback-box/chat-model.json;
  // read it on mount so the menu's checkmark reflects server state.
  useEffect(() => {
    if (!sessionId) return;
    getChatStatus({ sessionId })
      .then((status) => { setSelectedModel(status.model); })
      .catch(() => {});
  }, [sessionId]);

  // Chat-feature flags synced via /api/chat/features on mount, then kept
  // fresh through chat-features-changed events on the global SSE stream.
  useEffect(() => {
    if (!sessionId) return;
    getChatFeatures({ sessionId })
      .then((res) => { setChatFeatures(res.features); })
      .catch(() => {});
  }, [sessionId]);

  const narrationEnabled = chatFeatures.narration === "on";

  const handleToggleNarration = useCallback(() => {
    if (!sessionId) return;
    const next = narrationEnabled ? "off" : "on";
    // Optimistic — server-confirmed value lands via the SSE event handler.
    setChatFeatures((prev) => ({ ...prev, narration: next }));
    setChatFeature({ sessionId, feature: "narration", value: next })
      .then((res) => { setChatFeatures(res.features); })
      .catch((e: unknown) => {
        console.warn(`[chatfsm] set-feature narration failed: ${e instanceof Error ? e.message : String(e)}`);
      });
  }, [sessionId, narrationEnabled]);

  const handleSelectModel = useCallback((model: string | null) => {
    if (model === selectedModel) return;
    const label = MODEL_OPTIONS.find((o) => o.model === model)?.label ?? "default";
    setModelMarkers((markers) => [
      ...markers,
      {
        id: `model-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        label: `Switched to ${label}`,
        afterGroupCount: groupCount,
      },
    ]);
    setSelectedModel(model);
    if (sessionId) {
      console.debug(`[chatfsm] set-model request sessionId=${sessionId} model=${model ?? "<default>"}`);
      setChatModel({ sessionId, model })
        .then((res) => {
          console.debug(`[chatfsm] set-model response model=${res.model ?? "<default>"} ok=${res.ok}`);
          // Re-sync UI to whatever the server actually persisted, in case a
          // race / bug means the request landed differently than expected.
          setSelectedModel(res.model);
        })
        .catch((e: unknown) => {
          const msg = e instanceof Error ? e.message : String(e);
          console.warn(`[chatfsm] set-model error: ${msg}`);
        });
    } else {
      console.debug("[chatfsm] set-model skipped — sessionId is null");
    }
  }, [selectedModel, groupCount, sessionId]);

  return { selectedModel, modelMarkers, chatFeatures, setChatFeatures, narrationEnabled, handleToggleNarration, handleSelectModel };
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
  isStreaming: boolean;
  send: ChatSendFn;
}) {
  const { messages, isStreaming, send } = opts;
  const [activeSchedules, setActiveSchedules] = useState<ChatSchedule[]>([]);

  const fetchSchedules = useCallback(() => {
    fetch(`${getApiBase()}/chat/schedules`)
      .then((r) => r.json())
      .then((data: { schedules: ChatSchedule[] }) => {
        setActiveSchedules(data.schedules);
      })
      .catch(() => {});
  }, []);

  // Poll schedules on mount + after each turn completes
  useEffect(() => {
    fetchSchedules();
  }, [messages, fetchSchedules]);

  // Poll for history updates when a schedule has fired (fallback for SSE)
  const prevMessageCountRef = useRef(messages.length);
  useEffect(() => {
    prevMessageCountRef.current = messages.length;
  }, [messages.length]);

  useEffect(() => {
    if (activeSchedules.length === 0) return;
    if (isStreaming) return; // Don't poll while user is streaming

    const checkAndPoll = () => {
      const now = Date.now();
      const anyFired = activeSchedules.some(
        (s) => new Date(s.firesAt).getTime() <= now
      );
      if (!anyFired) return;

      fetch(`${getApiBase()}/chat/history`)
        .then((r) => r.json())
        .then((data: { entries: SessionEntry[]; sessionId: string | null }) => {
          // Only update if message count actually changed
          if (data.entries.length !== prevMessageCountRef.current) {
            send({ type: "SET_MESSAGES", messages: data.entries, sessionId: data.sessionId });
          }
          fetchSchedules();
        })
        .catch(() => {});
    };

    // Start polling every 3 seconds
    const id = setInterval(checkAndPoll, 3000);
    // Also check immediately
    checkAndPoll();
    return () => clearInterval(id);
  }, [activeSchedules, send, fetchSchedules, isStreaming]);

  const handleCancelSchedule = useCallback((label: string) => {
    fetch(`${getApiBase()}/chat/schedules/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label }),
    })
      .then(() => fetchSchedules())
      .catch(() => {});
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
      getChatHistory({ sessionId, tail: HISTORY_TAIL, minRealUserMessages: MIN_REAL_USER_MESSAGES })
        .then((data) => {
          send({ type: "SET_MESSAGES", messages: data.entries, sessionId: data.sessionId });
        })
        .catch(() => {});
    };
    const id = setInterval(poll, 5000);
    return () => clearInterval(id);
  }, [pendingCount, send, sessionId]);
}

