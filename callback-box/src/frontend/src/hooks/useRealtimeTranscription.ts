/**
 * Hook for realtime speech-to-text via XState machine.
 *
 * Captures mic audio via AudioWorklet (PCM 16kHz mono), streams it
 * over a WebSocket proxy to the backend, which forwards to Mistral.
 * Returns live transcript text as the user speaks.
 */

import { useCallback, useEffect, useRef } from "react";
import { useMachine } from "@xstate/react";
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
}

export function useRealtimeTranscription(
  options?: UseRealtimeTranscriptionOptions
): UseRealtimeTranscriptionResult {
  const [snapshot, send] = useMachine(realtimeTranscriptionMachine);
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });
  const doneResolveRef = useRef<((text: string) => void) | null>(null);
  const prevTranscriptRef = useRef("");

  // Map machine state to TranscriptionState
  const state: TranscriptionState = snapshot.matches("recording")
    ? "recording"
    : snapshot.matches("finalizing")
      ? "finalizing"
      : snapshot.matches("connecting")
        ? "connecting"
        : "idle";

  const { transcript, error } = snapshot.context;

  // Keyword detection: run when transcript changes
  useEffect(() => {
    if (transcript === prevTranscriptRef.current) return;
    prevTranscriptRef.current = transcript;

    if (!transcript || state !== "recording") return;

    const keyword = detectKeyword(transcript);
    if (!keyword) return;

    if (keyword.action === "send") {
      console.log("[realtime-transcription] Keyword SEND detected, processedTranscript:", JSON.stringify(keyword.processedTranscript));
      optionsRef.current?.onKeywordSend?.(keyword.processedTranscript);
    } else if (keyword.action === "micOff") {
      console.log("[realtime-transcription] Keyword MIC_OFF detected");
      send({ type: "CANCEL" });
      optionsRef.current?.onKeywordMicOff?.();
    } else if (keyword.action === "cancel") {
      console.log("[realtime-transcription] Keyword CANCEL detected");
      optionsRef.current?.onKeywordCancel?.();
    } else if (keyword.action === "erase") {
      console.log("[realtime-transcription] Keyword ERASE detected — resetting transcript");
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

  return { state, transcript, error, start, stop, cancel };
}
