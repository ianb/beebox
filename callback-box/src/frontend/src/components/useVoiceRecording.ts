/**
 * useVoiceRecording - encapsulates microphone capture for the NewMemo form.
 *
 * Owns the MediaRecorder lifecycle, the recording timer, the captured blob,
 * and the duration counter. Returns the current state plus start/stop/clear
 * controls. Keeps hook call order stable for the consuming component.
 */

import { useState, useRef, useCallback } from "react";

export type RecordingState = "idle" | "recording";

interface VoiceRecording {
  recordingState: RecordingState;
  duration: number;
  audioBlob: Blob | null;
  error: string | null;
  startRecording: () => Promise<void>;
  stopRecording: () => void;
  clearRecording: () => void;
  setError: (error: string | null) => void;
}

function pickMimeType(): string {
  if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) {
    return "audio/webm;codecs=opus";
  }
  if (MediaRecorder.isTypeSupported("audio/webm")) {
    return "audio/webm";
  }
  return "";
}

export function useVoiceRecording(): VoiceRecording {
  const [recordingState, setRecordingState] = useState<RecordingState>("idle");
  const [duration, setDuration] = useState(0);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(0);

  const startRecording = useCallback(async () => {
    try {
      setError(null);

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      const mimeType = pickMimeType();

      const mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      mediaRecorder.onstop = () => {
        for (const track of stream.getTracks()) track.stop();

        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }

        const blob = new Blob(chunksRef.current, {
          type: mediaRecorder.mimeType || "audio/webm",
        });
        setAudioBlob(blob);
        setRecordingState("idle");
      };

      mediaRecorder.onerror = () => {
        setError("Recording failed");
        setRecordingState("idle");
      };

      mediaRecorder.start(1000);
      setRecordingState("recording");
      startTimeRef.current = Date.now();

      timerRef.current = window.setInterval(() => {
        setDuration(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }, 100);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("Permission denied") || message.includes("NotAllowedError")) {
        setError("Microphone permission denied");
      } else {
        setError(`Failed to start recording: ${message}`);
      }
    }
  }, []);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && recordingState === "recording") {
      mediaRecorderRef.current.stop();
    }
  }, [recordingState]);

  const clearRecording = useCallback(() => {
    setAudioBlob(null);
    setDuration(0);
  }, []);

  return {
    recordingState,
    duration,
    audioBlob,
    error,
    startRecording,
    stopRecording,
    clearRecording,
    setError,
  };
}
