/**
 * Hook for voice recording using MediaRecorder API.
 *
 * Provides a reusable voice recording interface that can be used
 * for voice memos, feedback comments, query responses, etc.
 */

import { useState, useRef, useCallback } from "react";

export type RecordingState = "idle" | "recording" | "uploading";

export interface VoiceRecordingResult {
  blob: Blob;
  mimeType: string;
  duration: number;
}

export interface UseVoiceRecorderOptions {
  /** Called when recording completes successfully */
  onComplete: (result: VoiceRecordingResult) => Promise<void>;
}

export interface UseVoiceRecorderReturn {
  state: RecordingState;
  error: string | null;
  duration: number;
  startRecording: () => Promise<void>;
  stopRecording: () => void;
  formatDuration: (seconds: number) => string;
}

/**
 * Hook for voice recording functionality.
 *
 * Usage:
 * ```tsx
 * const { state, error, duration, startRecording, stopRecording, formatDuration } = useVoiceRecorder({
 *   onComplete: async (result) => {
 *     // Upload the audio blob
 *     await uploadAudio(result.blob);
 *   },
 * });
 * ```
 */
export function useVoiceRecorder({
  onComplete,
}: UseVoiceRecorderOptions): UseVoiceRecorderReturn {
  const [state, setState] = useState<RecordingState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(0);

  const startRecording = useCallback(async () => {
    try {
      setError(null);

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      // Prefer webm with opus codec, fallback to whatever is supported
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
          ? "audio/webm"
          : "";

      const mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      mediaRecorder.onstop = async () => {
        // Stop all tracks
        stream.getTracks().forEach((track) => track.stop());

        // Clear timer
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }

        // Create blob
        const blob = new Blob(chunksRef.current, {
          type: mediaRecorder.mimeType || "audio/webm",
        });

        const recordingDuration = Math.floor((Date.now() - startTimeRef.current) / 1000);

        setState("uploading");

        try {
          await onComplete({
            blob,
            mimeType: mediaRecorder.mimeType || "audio/webm",
            duration: recordingDuration,
          });
          setState("idle");
          setDuration(0);
        } catch (err) {
          setError((err as Error).message);
          setState("idle");
        }
      };

      mediaRecorder.onerror = () => {
        setError("Recording failed");
        setState("idle");
      };

      // Start recording
      mediaRecorder.start(1000); // Capture every second
      setState("recording");
      startTimeRef.current = Date.now();

      // Update duration timer
      timerRef.current = window.setInterval(() => {
        setDuration(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }, 100);
    } catch (err) {
      const message = (err as Error).message;
      if (message.includes("Permission denied") || message.includes("NotAllowedError")) {
        setError("Microphone permission denied. Please allow microphone access.");
      } else {
        setError(`Failed to start recording: ${message}`);
      }
    }
  }, [onComplete]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && state === "recording") {
      mediaRecorderRef.current.stop();
    }
  }, [state]);

  const formatDuration = useCallback((seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  }, []);

  return {
    state,
    error,
    duration,
    startRecording,
    stopRecording,
    formatDuration,
  };
}
