/**
 * Hook for realtime speech-to-text via Mistral Voxtral Realtime API.
 *
 * Captures mic audio via AudioWorklet (PCM 16kHz mono), streams it
 * over a WebSocket proxy to the backend, which forwards to Mistral.
 * Returns live transcript text as the user speaks.
 */

import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { getApiBase } from "../api";
import pcmProcessorUrl from "../audio/pcm-processor.worklet.js?url";
import { detectKeyword } from "../lib/speech-keywords";

export type TranscriptionState = "idle" | "connecting" | "recording" | "finalizing";

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCodePoint(byte);
  }
  return btoa(binary);
}

export interface UseRealtimeTranscriptionOptions {
  onKeywordSend?: (processedTranscript: string) => void;
  onKeywordCancel?: () => void;
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

interface MessageContext {
  transcriptRef: React.MutableRefObject<string>;
  doneResolveRef: React.MutableRefObject<((text: string) => void) | null>;
  optionsRef: React.MutableRefObject<UseRealtimeTranscriptionOptions | undefined>;
  setTranscript: (text: string) => void;
  setState: (state: TranscriptionState) => void;
  setError: (error: string | null) => void;
  cleanup: () => void;
}

function handleTextDelta(ctx: MessageContext, delta: string) {
  ctx.transcriptRef.current += delta;
  ctx.setTranscript(ctx.transcriptRef.current);

  const keyword = detectKeyword(ctx.transcriptRef.current);
  if (keyword?.action === "send") {
    console.log("[realtime-transcription] Keyword SEND detected, processedTranscript:", JSON.stringify(keyword.processedTranscript));
    console.log("[realtime-transcription] optionsRef.current:", ctx.optionsRef.current);
    console.log("[realtime-transcription] onKeywordSend:", ctx.optionsRef.current?.onKeywordSend);
    ctx.optionsRef.current?.onKeywordSend?.(keyword.processedTranscript);
  } else if (keyword?.action === "cancel") {
    console.log("[realtime-transcription] Keyword CANCEL detected");
    ctx.optionsRef.current?.onKeywordCancel?.();
  }
}

function handleTranscriptionDone(ctx: MessageContext, text: string | undefined) {
  if (text) {
    ctx.transcriptRef.current = text;
    ctx.setTranscript(text);
  }
  if (ctx.doneResolveRef.current) {
    ctx.doneResolveRef.current(ctx.transcriptRef.current);
    ctx.doneResolveRef.current = null;
  }
  ctx.setState("idle");
  ctx.cleanup();
}

function handleTranscriptionError(ctx: MessageContext, errDetail: unknown) {
  const errMsg = typeof errDetail === "object"
    ? (errDetail as { message?: string })?.message || JSON.stringify(errDetail)
    : errDetail || "Transcription error";
  console.error("[realtime-transcription] Error from server:", errMsg);
  ctx.setError(typeof errMsg === "string" ? errMsg : String(errMsg));
  ctx.setState("idle");
  ctx.cleanup();
}

function dispatchMessage(ctx: MessageContext, data: string) {
  const msg = JSON.parse(data);
  console.log("[realtime-transcription] Received:", msg.type || msg);

  if (msg.type === "transcription.text.delta") {
    const delta = msg.delta ?? msg.text ?? "";
    if (delta) {
      handleTextDelta(ctx, delta);
    }
  } else if (msg.type === "transcription.done") {
    handleTranscriptionDone(ctx, msg.text);
  } else if (msg.type === "session.created" || msg.type === "session.updated") {
    console.log("[realtime-transcription] Session ready:", msg.session?.id);
  } else if (msg.type === "transcription.segment") {
    console.log("[realtime-transcription] Segment:", msg.text);
  } else if (msg.type === "transcription.language") {
    console.log("[realtime-transcription] Language:", msg.language);
  } else if (msg.type === "error") {
    handleTranscriptionError(ctx, msg.error);
  }
}

export function useRealtimeTranscription(
  options?: UseRealtimeTranscriptionOptions
): UseRealtimeTranscriptionResult {
  const [state, setState] = useState<TranscriptionState>("idle");
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const doneResolveRef = useRef<((text: string) => void) | null>(null);
  const transcriptRef = useRef("");
  const optionsRef = useRef(options);

  useEffect(() => {
    optionsRef.current = options;
  });

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
    if (doneResolveRef.current) {
      doneResolveRef.current(transcriptRef.current);
      doneResolveRef.current = null;
    }
  }, []);

  useEffect(() => {
    return cleanup;
  }, [cleanup]);

  const msgCtx = useMemo<MessageContext>(() => ({
    transcriptRef,
    doneResolveRef,
    optionsRef,
    setTranscript,
    setState,
    setError,
    cleanup,
  }), [cleanup]);

  const start = useCallback(async () => {
    if (state !== "idle") return;

    setError(null);
    setTranscript("");
    transcriptRef.current = "";
    setState("connecting");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const audioContext = new AudioContext();
      audioContextRef.current = audioContext;
      await audioContext.audioWorklet.addModule(pcmProcessorUrl);

      const source = audioContext.createMediaStreamSource(stream);
      const workletNode = new AudioWorkletNode(audioContext, "pcm-processor");
      workletNodeRef.current = workletNode;
      source.connect(workletNode);

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
          dispatchMessage(msgCtx, event.data);
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
        setState("idle");
      };

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
  }, [state, cleanup, msgCtx]);

  const stop = useCallback((): Promise<string> => {
    if (state !== "recording") {
      return Promise.resolve(transcriptRef.current);
    }

    setState("finalizing");

    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop();
      }
    }
    if (workletNodeRef.current) {
      workletNodeRef.current.disconnect();
      workletNodeRef.current = null;
    }

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: "input_audio.end",
      }));
    }

    return new Promise<string>((resolve) => {
      doneResolveRef.current = resolve;

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
