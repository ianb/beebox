/**
 * Hook for realtime speech-to-text via Mistral Voxtral Realtime API.
 *
 * Captures mic audio via AudioWorklet (PCM 16kHz mono), streams it
 * over a WebSocket proxy to the backend, which forwards to Mistral.
 * Returns live transcript text as the user speaks.
 */

import { useState, useRef, useCallback, useEffect } from "react";
import { getApiBase } from "../api";
import pcmProcessorUrl from "../audio/pcm-processor.worklet.js?url";

export type TranscriptionState = "idle" | "connecting" | "recording" | "finalizing";

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCodePoint(byte);
  }
  return btoa(binary);
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

export function useRealtimeTranscription(): UseRealtimeTranscriptionResult {
  const [state, setState] = useState<TranscriptionState>("idle");
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  // Resolve function for the stop() promise — called when transcription.done arrives
  const doneResolveRef = useRef<((text: string) => void) | null>(null);
  // Mirror of transcript state accessible in callbacks without stale closures
  const transcriptRef = useRef("");

  const cleanup = useCallback(() => {
    if (workletNodeRef.current) {
      workletNodeRef.current.disconnect();
      workletNodeRef.current = null;
    }
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop();
      }
      streamRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    if (wsRef.current) {
      if (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING) {
        wsRef.current.close();
      }
      wsRef.current = null;
    }
    // Resolve any pending stop() promise with whatever we have
    if (doneResolveRef.current) {
      doneResolveRef.current(transcriptRef.current);
      doneResolveRef.current = null;
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return cleanup;
  }, [cleanup]);

  const start = useCallback(async () => {
    if (state !== "idle") return;

    setError(null);
    setTranscript("");
    transcriptRef.current = "";
    setState("connecting");

    try {
      // Get mic access
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // Set up AudioContext + Worklet
      const audioContext = new AudioContext();
      audioContextRef.current = audioContext;

      // Load the worklet processor (pcmProcessorUrl is a Vite ?url import)
      await audioContext.audioWorklet.addModule(pcmProcessorUrl);

      const source = audioContext.createMediaStreamSource(stream);
      const workletNode = new AudioWorkletNode(audioContext, "pcm-processor");
      workletNodeRef.current = workletNode;

      // Connect source → worklet (no output to speakers)
      source.connect(workletNode);

      // Open WebSocket to backend proxy
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const wsUrl = `${protocol}//${window.location.host}${getApiBase()}/chat/transcribe-ws`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log("[realtime-transcription] WebSocket connected");
        setState("recording");
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          console.log("[realtime-transcription] Received:", msg.type || msg);

          if (msg.type === "transcription.text.delta") {
            const delta = msg.delta ?? msg.text ?? "";
            if (delta) {
              transcriptRef.current += delta;
              setTranscript(transcriptRef.current);
            }
          } else if (msg.type === "transcription.done") {
            const finalText = msg.text;
            if (finalText) {
              transcriptRef.current = finalText;
              setTranscript(finalText);
            }
            // Resolve the stop() promise with the final text
            if (doneResolveRef.current) {
              doneResolveRef.current(transcriptRef.current);
              doneResolveRef.current = null;
            }
            setState("idle");
            cleanup();
          } else if (msg.type === "session.created" || msg.type === "session.updated") {
            console.log("[realtime-transcription] Session ready:", msg.session?.id);
          } else if (msg.type === "transcription.segment") {
            // Segment-level delta, log for debugging
            console.log("[realtime-transcription] Segment:", msg.text);
          } else if (msg.type === "transcription.language") {
            console.log("[realtime-transcription] Language:", msg.language);
          } else if (msg.type === "error") {
            const errDetail = msg.error;
            const errMsg = typeof errDetail === "object"
              ? errDetail?.message || JSON.stringify(errDetail)
              : errDetail || "Transcription error";
            console.error("[realtime-transcription] Error from server:", errMsg);
            setError(typeof errMsg === "string" ? errMsg : String(errMsg));
            setState("idle");
            cleanup();
          }
        } catch {
          // Non-JSON message, ignore
        }
      };

      ws.onerror = (event) => {
        console.error("[realtime-transcription] WebSocket error:", event);
        setError("WebSocket connection error");
        setState("idle");
        cleanup();
      };

      ws.onclose = (event) => {
        console.log("[realtime-transcription] WebSocket closed:", event.code, event.reason);
        // Always reset to idle on unexpected close
        setState("idle");
      };

      // Stream PCM chunks from worklet → WebSocket
      workletNode.port.onmessage = (event) => {
        if (event.data.type === "pcm" && ws.readyState === WebSocket.OPEN) {
          const base64Audio = arrayBufferToBase64(event.data.samples);
          ws.send(JSON.stringify({
            type: "input_audio.append",
            audio: base64Audio,
          }));
        }
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to start recording";
      console.error("[realtime-transcription] Start error:", msg);
      setError(msg);
      setState("idle");
      cleanup();
    }
  }, [state, cleanup]);

  const stop = useCallback((): Promise<string> => {
    if (state !== "recording") {
      return Promise.resolve(transcriptRef.current);
    }

    setState("finalizing");

    // Stop mic immediately so no more audio is captured
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop();
      }
    }
    if (workletNodeRef.current) {
      workletNodeRef.current.disconnect();
      workletNodeRef.current = null;
    }

    // Tell Mistral we're done sending audio
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: "input_audio.end",
      }));
    }

    // Return a promise that resolves when transcription.done arrives (or timeout)
    return new Promise<string>((resolve) => {
      doneResolveRef.current = resolve;

      // Safety timeout — if transcription.done doesn't arrive within 5s, resolve with what we have
      setTimeout(() => {
        if (doneResolveRef.current) {
          console.warn("[realtime-transcription] Timed out waiting for transcription.done");
          doneResolveRef.current(transcriptRef.current);
          doneResolveRef.current = null;
          setState("idle");
          cleanup();
        }
      }, 5000);
    });
  }, [state, cleanup]);

  const cancel = useCallback(() => {
    setTranscript("");
    transcriptRef.current = "";
    setError(null);
    setState("idle");
    cleanup();
  }, [cleanup]);

  return { state, transcript, error, start, stop, cancel };
}
