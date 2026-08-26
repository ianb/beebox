/**
 * The chat's model and feature state — split out of `InteractiveChat-hooks.ts`
 * to keep that file under the line cap when the model half grew a second
 * level (this chat's pick vs the box default; see
 * `docs/plans/model-engine-policy.md`).
 */

import { useState, useEffect, useRef, useCallback } from "react";
import {
  getChatStatus,
  setChatModel,
  setDefaultChatModel,
  getChatFeatures,
  setChatFeature,
} from "../../api";
import { type ModelMarker } from "./InteractiveChat-helpers";
import { chatModelOptions, type ChatAgentEngine } from "@shared/chat-models.js";
import { toastError } from "../ui/toast-store";
import type { ChatEvent } from "../../machines/chat-types";

/**
 * Persisted model selection + chat-feature flags (narration, prose, …), with
 * the ephemeral model-switch markers shown in the stream. Server state is
 * read on mount; feature changes are optimistic and reconciled by the SSE
 * `chat-features-changed` handler in the parent.
 */
export function useChatModelFeatures(opts: { sessionId: string | null; groupCount: number; send: (event: ChatEvent) => void }) {
  const { sessionId, groupCount, send } = opts;
  // This chat's OWN pick; `null` means it follows the box default. The
  // effective model is `modelInForce` — the two differ for a follower.
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [modelInForce, setModelInForce] = useState<string | null>(null);
  const [boxDefault, setBoxDefault] = useState<string | null>(null);
  const [agentEngine, setAgentEngine] = useState<ChatAgentEngine | null>(null);
  const [modelMarkers, setModelMarkers] = useState<ModelMarker[]>([]);
  const [chatFeatures, setChatFeatures] = useState<Record<string, string>>({});

  /**
   * Re-read the model state. Called on mount and whenever the model panel
   * opens: the box default can change from another tab or the admin page, and
   * nothing pushes that here — an open chat would otherwise keep showing the
   * default it read when it loaded.
   */
  const refreshModelStatus = useCallback(async () => {
    const status = await getChatStatus({ sessionId });
    setSelectedModel(status.source === "explicit" ? status.model : null);
    setModelInForce(status.model);
    setBoxDefault(status.boxDefault);
    setAgentEngine(status.engine);
  }, [sessionId]);

  // For a fresh chat, status reports the box's configured engine and default.
  useEffect(() => {
    let current = true;
    setAgentEngine(null);
    getChatStatus({ sessionId })
      .then((status) => {
        if (!current) return;
        setSelectedModel(status.source === "explicit" ? status.model : null);
        setModelInForce(status.model);
        setBoxDefault(status.boxDefault);
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
  const hqDictationEnabled = chatFeatures["hq-dictation"] === "on";

  // Generation counters so an out-of-order completion (an older toggle/select
  // resolving after a newer one) can't clobber state a later request already
  // set — bumped on every call, and a response only applies if it's still the
  // most recent one in flight.
  const narrationRequestIdRef = useRef(0);
  const hqDictationRequestIdRef = useRef(0);
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

  // Mirrors handleToggleNarration exactly (docs/implemented-plans/hq-dictation-switch.md,
  // chunk 1) — a separate feature slot, separate request-id generation, same
  // optimistic-set/rollback shape.
  const handleToggleHqDictation = useCallback(() => {
    const next = hqDictationEnabled ? "off" : "on";
    const previous = hqDictationEnabled ? "on" : "off";
    const requestId = ++hqDictationRequestIdRef.current;
    setChatFeatures((prev) => ({ ...prev, "hq-dictation": next }));
    if (!sessionId) {
      send({ type: "SET_SEED_FEATURE", feature: "hq-dictation", value: next });
      return;
    }
    setChatFeature({ sessionId, feature: "hq-dictation", value: next })
      .then((res) => {
        if (hqDictationRequestIdRef.current !== requestId) return;
        setChatFeatures(res.features);
      })
      .catch((e: unknown) => {
        console.warn(`[chatfsm] set-feature hq-dictation failed: ${e instanceof Error ? e.message : String(e)}`);
        toastError("Failed to update HQ dictation", { cause: e });
        if (hqDictationRequestIdRef.current !== requestId) return;
        setChatFeatures((prev) => ({ ...prev, "hq-dictation": previous }));
      });
  }, [sessionId, hqDictationEnabled, send]);

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
    setModelInForce(model ?? boxDefault);
    if (sessionId) {
      console.debug(`[chatfsm] set-model request sessionId=${sessionId} model=${model ?? "<default>"}`);
      setChatModel({ sessionId, model })
        .then((res) => {
          console.debug(`[chatfsm] set-model response model=${res.model ?? "<default>"} ok=${res.ok}`);
          if (modelRequestIdRef.current !== requestId) return;
          // Re-sync UI to whatever the server actually persisted, in case a
          // race / bug means the request landed differently than expected.
          setSelectedModel(res.model);
          setModelInForce(res.model ?? boxDefault);
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
          setModelInForce(previous ?? boxDefault);
        });
    } else {
      console.debug("[chatfsm] set-model skipped — sessionId is null");
    }
  }, [selectedModel, boxDefault, groupCount, sessionId, agentEngine]);

  /**
   * Pin the box default. Deliberately does not touch this chat: a follower
   * shows the new default immediately (nothing of its own is running yet) but
   * a live chat keeps the model its subprocess started with until it restarts,
   * which is what the server reports back.
   */
  const handlePinModel = useCallback((model: string | null) => {
    setBoxDefault(model);
    setDefaultChatModel({ model })
      .then(async (res) => {
        if (res.commitWarning !== null) console.warn(`[chatfsm] set-default-model: ${res.commitWarning}`);
        await refreshModelStatus();
      })
      .catch((e: unknown) => {
        console.warn(`[chatfsm] set-default-model failed: ${e instanceof Error ? e.message : String(e)}`);
        toastError("Failed to set the box default model", { cause: e });
        // No event corrects a rejected write, so re-read rather than leaving
        // the optimistic value standing.
        void refreshModelStatus().catch(() => {});
      });
  }, [refreshModelStatus]);

  const handleOpenModelPanel = useCallback(() => {
    void refreshModelStatus().catch((e: unknown) => {
      console.warn(`[chatfsm] model-status refresh failed: ${e instanceof Error ? e.message : String(e)}`);
    });
  }, [refreshModelStatus]);

  return {
    agentEngine, selectedModel, modelInForce, boxDefault, handlePinModel, handleOpenModelPanel,
    modelMarkers, chatFeatures, setChatFeatures,
    narrationEnabled, handleToggleNarration,
    hqDictationEnabled, handleToggleHqDictation,
    handleSelectModel,
  };
}

