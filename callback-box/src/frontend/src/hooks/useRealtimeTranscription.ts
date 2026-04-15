/**
 * Hook for realtime speech-to-text via XState machine.
 *
 * Captures mic audio via AudioWorklet (PCM 16kHz mono), streams it
 * over a WebSocket proxy to the backend, which forwards to Mistral.
 * Returns live transcript text as the user speaks.
 */

import { useCallback, useEffect, useRef } from "react";
import { useSSRMachine } from "./useSSRMachine";
import {
  realtimeTranscriptionMachine,
  type TranscriptionState,
} from "../machines/realtimeTranscriptionMachine";
import { detectKeyword } from "../lib/speech-keywords";

export type { TranscriptionState };

export interface UseRealtimeTranscriptionOptions {
  onKeywordSend?: (processedTranscript: string) => void;
  onKeywordCancel?: () => void;
  onKeywordMicOff?: () => void;
  onKeywordErase?: () => void;
}

export interface UseRealtimeTranscriptionResult {
  state: TranscriptionState;
  transcript: string;
  error: string | null;
  start: () => void;
  /** Stop recording and wait for final transcript. Returns the final text. */
  stop: () => Promise<string>;
  cancel: () => void;
  dismissError: () => void;
}

export function useRealtimeTranscription(
  options?: UseRealtimeTranscriptionOptions
): UseRealtimeTranscriptionResult {
  const [snapshot, send] = useSSRMachine(realtimeTranscriptionMachine);
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });
  const doneResolveRef = useRef<((text: string) => void) | null>(null);
  const prevTranscriptRef = useRef("");

  // Map machine state to TranscriptionState (nested under "active" parent)
  const state: TranscriptionState = snapshot.matches({ active: "recording" })
    ? "recording"
    : snapshot.matches({ active: "finalizing" })
      ? "finalizing"
      : snapshot.matches({ active: "connecting" })
        ? "connecting"
        : "idle";

  const { transcript, error } = snapshot.context;

  // Screen Wake Lock: keep device awake while recording
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const isActive = state !== "idle";

  useEffect(() => {
    if (!isActive) {
      if (wakeLockRef.current) {
        wakeLockRef.current.release().catch(() => {});
        wakeLockRef.current = null;
      }
      return;
    }
    let cancelled = false;
    navigator.wakeLock?.request("screen").then((sentinel) => {
      if (cancelled) {
        sentinel.release().catch(() => {});
      } else {
        wakeLockRef.current = sentinel;
      }
    }).catch((err) => {
      console.warn("[realtime-transcription] Wake lock failed:", err);
    });
    return () => {
      cancelled = true;
      if (wakeLockRef.current) {
        wakeLockRef.current.release().catch(() => {});
        wakeLockRef.current = null;
      }
    };
  }, [isActive]);

  // Re-acquire wake lock when tab regains focus (browser releases it on hide)
  useEffect(() => {
    if (!isActive) return;
    const handleVisibility = () => {
      if (document.visibilityState === "visible" && wakeLockRef.current && wakeLockRef.current.released) {
        navigator.wakeLock?.request("screen").then((sentinel) => {
          wakeLockRef.current = sentinel;
        }).catch(() => {});
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [isActive]);

  // Keyword detection: run when transcript changes
  useEffect(() => {
    if (transcript === prevTranscriptRef.current) return;
    prevTranscriptRef.current = transcript;

    if (!transcript || state !== "recording") return;

    const keyword = detectKeyword(transcript);
    if (!keyword) return;

    if (keyword.action === "send") {
      optionsRef.current?.onKeywordSend?.(keyword.processedTranscript);
    } else if (keyword.action === "micOff") {
      send({ type: "CANCEL" });
      optionsRef.current?.onKeywordMicOff?.();
    } else if (keyword.action === "cancel") {
      optionsRef.current?.onKeywordCancel?.();
    } else if (keyword.action === "erase") {
      send({ type: "CANCEL" });
      // Restart immediately after erase
      send({ type: "START" });
    }
  }, [transcript, state, send]);

  // Resolve stop() promise when machine returns to idle
  useEffect(() => {
    if (state === "idle" && doneResolveRef.current) {
      doneResolveRef.current(transcript);
      doneResolveRef.current = null;
    }
  }, [state, transcript]);

  const start = useCallback(() => {
    prevTranscriptRef.current = "";
    send({ type: "START" });
  }, [send]);

  const stop = useCallback((): Promise<string> => {
    if (state !== "recording") {
      return Promise.resolve(transcript);
    }
    send({ type: "STOP" });
    return new Promise<string>((resolve) => {
      doneResolveRef.current = resolve;
    });
  }, [state, transcript, send]);

  const cancel = useCallback(() => {
    prevTranscriptRef.current = "";
    send({ type: "CANCEL" });
  }, [send]);

  const dismissError = useCallback(() => {
    send({ type: "DISMISS_ERROR" });
  }, [send]);

  return { state, transcript, error, start, stop, cancel, dismissError };
}
